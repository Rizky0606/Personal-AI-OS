import type {
  Conversation,
  CreateConversationRequestSchema,
  Message,
  RerouteRequestSchema,
  RerouteResponseSchema,
  Run,
  SendMessageRequestSchema,
  UpdateConversationRequestSchema,
} from '@aios/contracts';
import { HANDOFF_PREFIX, TERMINAL_RUN_STATUSES } from '@aios/contracts';
import { and, desc, eq, gte, isNotNull, isNull, lt, notInArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { Database } from '../../db/client.js';
import { conversations, messages, projects, runs } from '../../db/schema/index.js';
import { AppError } from '../../errors.js';
import { uuidv7 } from '../../lib/uuidv7.js';
import type { FilesService } from '../files/service.js';
import { describeDecision, type RoutingService } from '../router/service.js';
import type { LaunchInput, Runner } from '../runs/runner.js';
import { toConversationDto, toCorrectionDto, toMessageDto, toRunDto } from './dto.js';
import type { TitleService } from './title.js';

export interface Page<T> {
  items: T[];
  nextBefore: string | null;
}

export interface ChatService {
  listConversations(q: {
    before?: string | undefined;
    limit: number;
    projectId?: string | undefined;
    spaceId?: string | undefined;
    archived?: 'true' | 'false' | undefined;
  }): Promise<Page<Conversation>>;
  createConversation(input: z.infer<typeof CreateConversationRequestSchema>): Promise<Conversation>;
  getConversation(id: string): Promise<Conversation>;
  updateConversation(
    id: string,
    patch: z.infer<typeof UpdateConversationRequestSchema>,
  ): Promise<Conversation>;
  archiveConversation(id: string): Promise<void>;
  /** Menghapus percakapan beserta pesannya; run dan jadwal yang merujuknya tetap ada tanpa rujukan. */
  deleteConversation(id: string): Promise<void>;
  listMessages(
    conversationId: string,
    q: { before?: string | undefined; limit: number },
  ): Promise<Page<Message>>;
  sendMessage(
    conversationId: string,
    input: z.infer<typeof SendMessageRequestSchema>,
    options?: {
      continueFromRunId?: string;
      taskId?: string;
      /**
       * Konteks tambahan untuk agent pada giliran ini saja (mis. data briefing, hasil run jadwal sebelumnya).
       * Dikirim setelah teks pesan tetapi tidak disimpan di pesan pengguna, jadi riwayat tetap ringkas.
       */
      context?: string;
    },
  ): Promise<{ message: Message; run: Run }>;
  /** Mengganti role pesan terakhir, mencatat koreksi, dan menjalankan ulang dengan role baru. */
  reroute(
    messageId: string,
    input: z.infer<typeof RerouteRequestSchema>,
  ): Promise<z.infer<typeof RerouteResponseSchema>>;
  /**
   * Mengubah pesan pengguna: pesan itu dan semua sesudahnya dibuang, lalu teks baru dikirim. Agent memulai
   * sesi baru dengan riwayat yang tersisa, jadi bagian yang dibuang tidak lagi diingat.
   */
  editMessage(
    messageId: string,
    input: z.infer<typeof SendMessageRequestSchema>,
  ): Promise<{ message: Message; run: Run }>;
  /** Menghapus pesan beserta semua pesan sesudahnya (memotong percakapan dari titik itu). */
  deleteMessage(messageId: string): Promise<void>;
  exists(id: string): Promise<boolean>;
  /** Menunggu pekerjaan latar belakang (judul) selesai; untuk shutdown dan tes. */
  idle(): Promise<void>;
}

const notFound = () => new AppError(404, 'conversation_not_found', 'Percakapan tidak ditemukan.');
const messageNotFound = () => new AppError(404, 'message_not_found', 'Pesan tidak ditemukan.');
const MAX_TITLE_CHARS = 200;
/** Batas riwayat yang dikirim ulang ke sesi baru setelah percakapan dipotong. */
const MAX_HISTORY_MESSAGES = 100;
/** Riwayat yang dikirim ke agent project; sama dengan batas `history` di kontrak run.start. */
const PROJECT_HISTORY_MESSAGES = 40;

export function createChatService(deps: {
  db: Database;
  runner: Runner;
  files: FilesService;
  titles: TitleService;
  routing: RoutingService;
  /** Untuk menentukan mesin dari role. */
  roles: { get(roleId: string): { engine: string } | undefined };
  /** Ruang pengetahuan (W21); tanpa ini percakapan tidak bisa terikat ke ruang. */
  spaces?: {
    exists(id: string): Promise<boolean>;
    contextFor(spaceId: string, question: string): Promise<string>;
  };
  now?: () => number;
}): ChatService {
  const { db, runner, files, titles, routing, roles, now = Date.now } = deps;

  /**
   * Teks yang dikirim ke agent: pesan, lalu potongan dokumen ruang (bila percakapan terikat ruang), lalu konteks
   * tambahan pemanggil. Hanya pesan yang disimpan; sisanya dihitung ulang tiap giliran.
   */
  async function agentPrompt(
    conversation: { spaceId: string | null },
    prompt: string,
    question: string,
    extra?: string,
  ): Promise<string> {
    const space =
      conversation.spaceId && deps.spaces
        ? await deps.spaces.contextFor(conversation.spaceId, question)
        : '';
    return [prompt, space, extra ?? ''].filter(Boolean).join('\n\n');
  }
  const background = new Set<Promise<unknown>>();

  async function getConversation(id: string) {
    const [row] = await db.select().from(conversations).where(eq(conversations.id, id));
    if (!row) throw notFound();
    return row;
  }

  /** Hanya mengisi judul yang masih kosong, supaya judul yang diubah pemilik tidak tertimpa. */
  async function autoTitle(conversationId: string, text: string) {
    const title = await titles.generate(text);
    if (!title) return;
    await db
      .update(conversations)
      .set({ title })
      .where(and(eq(conversations.id, conversationId), eq(conversations.title, '')));
  }

  const textOf = (parts: Message['parts']) =>
    parts
      .map((p) => (p.type === 'text' ? p.text : ''))
      .join('\n\n')
      .trim();

  /** Satu run aktif per percakapan: transkrip Hermes per sesi harus berurutan. */
  async function assertNoActiveRun(conversationId: string) {
    const [busy] = await db
      .select({ id: runs.id })
      .from(runs)
      .where(
        and(
          eq(runs.conversationId, conversationId),
          // needs_review menunggu manusia, bukan mesin yang masih bekerja: tidak memblokir pesan baru.
          notInArray(runs.status, [...TERMINAL_RUN_STATUSES, 'needs_review']),
        ),
      )
      .limit(1);
    if (busy) {
      throw new AppError(
        409,
        'run_in_progress',
        'Masih ada jawaban yang berjalan di percakapan ini. Tunggu selesai atau hentikan dulu.',
      );
    }
  }

  /** Role pada giliran terakhir yang sudah diputuskan; dasar aturan "pesan lanjutan". */
  async function previousRoleOf(conversationId: string): Promise<string | null> {
    const [row] = await db
      .select({ agentRole: runs.agentRole })
      .from(runs)
      .where(and(eq(runs.conversationId, conversationId), isNotNull(runs.agentRole)))
      .orderBy(desc(runs.id))
      .limit(1);
    return row?.agentRole ?? null;
  }

  async function latestUserMessage(conversationId: string) {
    const [row] = await db
      .select()
      .from(messages)
      .where(and(eq(messages.conversationId, conversationId), eq(messages.author, 'user')))
      .orderBy(desc(messages.id))
      .limit(1);
    return row;
  }

  /**
   * Sesi Hermes untuk giliran berikutnya. Percakapan yang dipotong (edit/hapus pesan) tidak punya sesi:
   * dibuat sesi baru, dan riwayat yang tersisa (sebelum `beforeId`) dikirim karena sesi lama masih memuat
   * bagian yang dibuang. Percakapan yang belum pernah punya run memakai sesi bawaan `aios-<id>`.
   */
  /** Pesan menjadi riwayat untuk agent; pesan sistem hanya yang membawa ringkasan lanjutan. */
  function historyFrom(
    rows: { author: string; parts: Message['parts'] }[],
  ): NonNullable<LaunchInput['history']> {
    return rows.flatMap((row): NonNullable<LaunchInput['history']> => {
      const content = textOf(row.parts);
      if (!content) return [];
      if (row.author === 'system') {
        return content.startsWith(HANDOFF_PREFIX)
          ? [
              { role: 'user', content },
              {
                role: 'assistant',
                content: 'Baik, konteks percakapan sebelumnya sudah saya pahami.',
              },
            ]
          : [];
      }
      if (row.author !== 'user' && row.author !== 'assistant') return [];
      return [{ role: row.author, content }];
    });
  }

  /** Giliran sebelum `beforeId` untuk agent project (worker): terbaru dibatasi, kronologis. */
  function projectHistoryFor(
    conversationId: string,
    beforeId: string,
  ): () => ReturnType<typeof loadProjectHistory> {
    return () => loadProjectHistory(conversationId, beforeId);
  }

  async function loadProjectHistory(conversationId: string, beforeId: string) {
    const rows = await db
      .select({ author: messages.author, parts: messages.parts })
      .from(messages)
      .where(and(eq(messages.conversationId, conversationId), lt(messages.id, beforeId)))
      .orderBy(desc(messages.id))
      .limit(PROJECT_HISTORY_MESSAGES);
    return historyFrom(rows.reverse());
  }

  async function sessionFor(
    conversation: typeof conversations.$inferSelect,
    beforeId?: string,
  ): Promise<{ sessionId: string; history: NonNullable<LaunchInput['history']> }> {
    if (conversation.hermesSessionId)
      return { sessionId: conversation.hermesSessionId, history: [] };
    const [anyRun] = await db
      .select({ id: runs.id })
      .from(runs)
      .where(eq(runs.conversationId, conversation.id))
      .limit(1);
    if (!anyRun) {
      // Percakapan lanjutan (ringkasan) atau cabang (salinan pesan): isinya menjadi riwayat awal.
      const seeds = await db
        .select({ author: messages.author, parts: messages.parts })
        .from(messages)
        .where(eq(messages.conversationId, conversation.id))
        .orderBy(desc(messages.id))
        .limit(MAX_HISTORY_MESSAGES);
      seeds.reverse();
      return { sessionId: `aios-${conversation.id}`, history: historyFrom(seeds) };
    }

    const rows = await db
      .select({ author: messages.author, parts: messages.parts })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversation.id),
          beforeId ? lt(messages.id, beforeId) : undefined,
        ),
      )
      .orderBy(desc(messages.id))
      .limit(MAX_HISTORY_MESSAGES);
    return {
      sessionId: `aios-${conversation.id}-${uuidv7()}`,
      history: historyFrom(rows.reverse()),
    };
  }

  /**
   * Isi pesan pengguna untuk agent: teks pengguna, dokumen lampiran sebagai teks, dan gambar. Router dan
   * judul memakai teks pengguna saja (plus nama lampiran), bukan isi dokumen yang bisa sangat panjang.
   */
  async function composeInput(input: z.infer<typeof SendMessageRequestSchema>) {
    const attachments = await files.prepare(input.parts);
    const text = textOf(input.parts);
    if (!text && attachments.parts.length === 0) {
      throw new AppError(400, 'empty_message', 'Pesan tidak boleh kosong.');
    }
    const names = attachments.parts.map((p) => p.name);
    const label = names.length ? `[Lampiran: ${names.join(', ')}]` : '';
    const userText = text || (attachments.images.length ? 'Lihat gambar terlampir.' : '');
    const prompt = [userText, attachments.documents].filter(Boolean).join('\n\n');
    return {
      // Part file disimpan dengan nama dan MIME dari database, bukan dari klien.
      parts: [
        ...input.parts.filter((p) => p.type !== 'file'),
        ...attachments.parts,
      ] as Message['parts'],
      prompt,
      routingText: [text, label].filter(Boolean).join(' '),
      images: attachments.images,
    };
  }

  /** Pesan dan percakapannya; percakapan yang diarsipkan tidak bisa diubah. */
  async function editableMessage(messageId: string) {
    const [found] = await db.select().from(messages).where(eq(messages.id, messageId));
    if (!found) throw messageNotFound();
    const conversation = await getConversation(found.conversationId);
    if (conversation.archivedAt) {
      throw new AppError(409, 'conversation_archived', 'Percakapan sudah diarsipkan.');
    }
    return { message: found, conversation };
  }

  /** Membuang pesan ini dan semua sesudahnya, lalu melepas sesi Hermes (dibuat ulang di giliran berikutnya). */
  async function truncateFrom(message: typeof messages.$inferSelect) {
    await assertNoActiveRun(message.conversationId);
    await db.transaction(async (tx) => {
      await tx
        .delete(messages)
        .where(
          and(eq(messages.conversationId, message.conversationId), gte(messages.id, message.id)),
        );
      await tx
        .update(conversations)
        .set({ hermesSessionId: null, updatedAt: new Date(now()) })
        .where(eq(conversations.id, message.conversationId));
    });
  }

  /**
   * Fungsi yang dijalankan runner pada status `routing`: memutuskan role (router atau pilihan manual),
   * menyimpannya ke routing_decisions, lalu menetapkan role pada run dan pesan asisten.
   */
  function makeResolver(args: {
    conversation: typeof conversations.$inferSelect;
    runId: string;
    userMessageId: string;
    assistantMessageId: string;
    prompt: string;
    previousRole: string | null;
    manualRole?: string;
  }): LaunchInput['resolveRole'] {
    return async (signal) => {
      const result = await routing.route(
        {
          message: args.prompt,
          surface: args.conversation.surface,
          projectId: args.conversation.projectId,
          conversationId: args.conversation.id,
          beforeMessageId: args.userMessageId,
          previousRole: args.previousRole,
          ...(args.manualRole ? { manualRole: args.manualRole } : {}),
        },
        signal,
      );
      const { role, confidence } = result.decision;
      await routing.record(args.userMessageId, result);
      const engine = roles.get(role)?.engine === 'omp' ? 'omp' : 'hermes';
      await db.update(runs).set({ agentRole: role, engine }).where(eq(runs.id, args.runId));
      await db
        .update(messages)
        .set({ agentRole: role })
        .where(eq(messages.id, args.assistantMessageId));
      return { role, confidence, reason: describeDecision(result) };
    };
  }

  const service: ChatService = {
    async listConversations(q) {
      const rows = await db
        .select()
        .from(conversations)
        .where(
          and(
            q.before ? lt(conversations.id, q.before) : undefined,
            q.projectId ? eq(conversations.projectId, q.projectId) : undefined,
            q.spaceId ? eq(conversations.spaceId, q.spaceId) : undefined,
            q.archived === 'true'
              ? isNotNull(conversations.archivedAt)
              : isNull(conversations.archivedAt),
          ),
        )
        .orderBy(desc(conversations.id))
        .limit(q.limit + 1);
      const items = rows.slice(0, q.limit);
      return {
        items: items.map(toConversationDto),
        nextBefore: rows.length > q.limit ? (items.at(-1)?.id ?? null) : null,
      };
    },

    async createConversation(input) {
      if (input.projectId) {
        const [project] = await db
          .select({ id: projects.id })
          .from(projects)
          .where(eq(projects.id, input.projectId));
        if (!project) throw new AppError(404, 'project_not_found', 'Project tidak ditemukan.');
      }
      if (input.spaceId && !(await deps.spaces?.exists(input.spaceId))) {
        throw new AppError(404, 'space_not_found', 'Ruang tidak ditemukan.');
      }
      const [row] = await db
        .insert(conversations)
        .values({
          title: (input.title ?? '').trim().slice(0, MAX_TITLE_CHARS),
          surface: input.surface,
          projectId: input.projectId ?? null,
          spaceId: input.spaceId ?? null,
        })
        .returning();
      return toConversationDto(row!);
    },

    async getConversation(id) {
      return toConversationDto(await getConversation(id));
    },

    async updateConversation(id, patch) {
      const set: Partial<typeof conversations.$inferInsert> = {};
      if (patch.title !== undefined) set.title = patch.title.trim().slice(0, MAX_TITLE_CHARS);
      if (patch.pinned !== undefined) set.pinned = patch.pinned;
      if (patch.archived !== undefined) set.archivedAt = patch.archived ? new Date(now()) : null;
      if (Object.keys(set).length === 0) return toConversationDto(await getConversation(id));
      const [row] = await db
        .update(conversations)
        .set(set)
        .where(eq(conversations.id, id))
        .returning();
      if (!row) throw notFound();
      return toConversationDto(row);
    },

    async archiveConversation(id) {
      const rows = await db
        .update(conversations)
        .set({ archivedAt: new Date(now()) })
        .where(eq(conversations.id, id))
        .returning({ id: conversations.id });
      if (rows.length === 0) throw notFound();
    },

    async deleteConversation(id) {
      await getConversation(id);
      // Jawaban yang masih berjalan menulis ke pesan percakapan ini; hentikan dulu dari aplikasi.
      await assertNoActiveRun(id);
      await db.delete(conversations).where(eq(conversations.id, id));
    },

    async listMessages(conversationId, q) {
      await getConversation(conversationId);
      // Halaman = pesan terbaru sebelum kursor; isi halaman diurutkan kronologis (lama ke baru).
      const rows = await db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, conversationId),
            q.before ? lt(messages.id, q.before) : undefined,
          ),
        )
        .orderBy(desc(messages.id))
        .limit(q.limit + 1);
      const items = rows.slice(0, q.limit).reverse();
      return {
        items: items.map(toMessageDto),
        nextBefore: rows.length > q.limit ? (items[0]?.id ?? null) : null,
      };
    },

    async sendMessage(conversationId, input, options) {
      const conversation = await getConversation(conversationId);
      if (conversation.archivedAt) {
        throw new AppError(409, 'conversation_archived', 'Percakapan sudah diarsipkan.');
      }
      const { parts, prompt, routingText, images } = await composeInput(input);
      // Pilihan manual diperiksa sekarang (400) agar tidak baru gagal setelah run dimulai.
      if (input.role) routing.assertRoleAllowed(input.role, conversation);
      await assertNoActiveRun(conversationId);

      const previousRole = await previousRoleOf(conversationId);
      const { sessionId, history } = await sessionFor(conversation);
      const model = input.model ?? null;

      const { run, userMessage, assistantMessageId } = await db.transaction(async (tx) => {
        // Role belum diketahui: router memutuskannya pada status `routing` di dalam run.
        const [runRow] = await tx
          .insert(runs)
          .values({
            kind: 'chat',
            engine: 'hermes',
            model,
            conversationId,
            planOnly: input.planOnly === true,
            ...(options?.taskId ? { taskId: options.taskId } : {}),
          })
          .returning();
        const [userRow] = await tx
          .insert(messages)
          .values({
            conversationId,
            author: 'user',
            parts,
            model,
            runId: runRow!.id,
          })
          .returning();
        // ID asisten dibuat setelah pesan user supaya urutan riwayat (menurut ID) benar.
        const assistantMessageId = uuidv7();
        await tx.insert(messages).values({
          id: assistantMessageId,
          conversationId,
          author: 'assistant',
          parts: [{ type: 'text', text: '' }],
          model,
          runId: runRow!.id,
        });
        await tx
          .update(conversations)
          .set({
            hermesSessionId: sql`coalesce(${conversations.hermesSessionId}, ${sessionId})`,
            updatedAt: new Date(now()),
          })
          .where(eq(conversations.id, conversationId));
        return { run: runRow!, userMessage: userRow!, assistantMessageId };
      });

      runner.launch({
        run,
        conversationId,
        assistantMessageId,
        prompt: await agentPrompt(conversation, prompt, routingText, options?.context),
        sessionId,
        ...(history.length ? { history } : {}),
        projectHistory: projectHistoryFor(conversationId, userMessage.id),
        ...(images.length ? { images } : {}),
        projectId: conversation.projectId,
        ...(options?.continueFromRunId ? { continueFromRunId: options.continueFromRunId } : {}),
        resolveRole: makeResolver({
          conversation,
          runId: run.id,
          userMessageId: userMessage.id,
          assistantMessageId,
          prompt: routingText,
          previousRole,
          ...(input.role ? { manualRole: input.role } : {}),
        }),
      });

      if (conversation.title === '') {
        const job = autoTitle(conversationId, routingText).catch(() => undefined);
        background.add(job);
        void job.finally(() => background.delete(job));
      }

      return { message: toMessageDto(userMessage), run: toRunDto(run) };
    },

    async reroute(messageId, { role }) {
      const [found] = await db.select().from(messages).where(eq(messages.id, messageId));
      if (!found) throw new AppError(404, 'message_not_found', 'Pesan tidak ditemukan.');

      // Klien biasanya memegang pesan asisten (chip role di atasnya); yang dikoreksi adalah pesan user yang dirutekan.
      let userMessage = found.author === 'user' ? found : undefined;
      if (found.author === 'assistant' && found.runId) {
        [userMessage] = await db
          .select()
          .from(messages)
          .where(
            and(
              eq(messages.conversationId, found.conversationId),
              eq(messages.author, 'user'),
              eq(messages.runId, found.runId),
            ),
          );
        // Pesan asisten hasil reroute tidak punya pesan user dengan runId yang sama: pakai pesan user terakhir.
        userMessage ??= await latestUserMessage(found.conversationId);
      }
      if (!userMessage) {
        throw new AppError(
          400,
          'message_not_reroutable',
          'Hanya pesan pengguna atau jawaban asisten yang bisa dirutekan ulang.',
        );
      }

      const conversation = await getConversation(userMessage.conversationId);
      if (conversation.archivedAt) {
        throw new AppError(409, 'conversation_archived', 'Percakapan sudah diarsipkan.');
      }
      const latest = await latestUserMessage(conversation.id);
      if (latest?.id !== userMessage.id) {
        throw new AppError(
          409,
          'not_latest_message',
          'Hanya pesan terakhir di percakapan yang bisa dirutekan ulang.',
        );
      }
      routing.assertRoleAllowed(role, conversation);

      const prompt = textOf(userMessage.parts);
      let decision = await routing.latestDecision(userMessage.id);
      const fromRole = decision?.role ?? (await previousRoleOf(conversation.id)) ?? 'general';
      if (fromRole === role) {
        throw new AppError(400, 'same_role', `Pesan ini sudah dijawab dengan role "${role}".`);
      }

      // Jawaban role lama yang masih berjalan dihentikan dulu; transkrip Hermes harus berurutan.
      const [lastRun] = await db
        .select({ id: runs.id })
        .from(runs)
        .where(eq(runs.conversationId, conversation.id))
        .orderBy(desc(runs.id))
        .limit(1);
      if (lastRun && runner.isActive(lastRun.id)) await runner.cancel(lastRun.id);
      await assertNoActiveRun(conversation.id);

      // Koreksi merujuk keputusan router. Bila tidak pernah tercatat (run gagal sebelum routing), buat catatannya.
      decision ??= await routing.record(userMessage.id, {
        decision: {
          role: fromRole,
          confidence: 0,
          reason: 'Keputusan awal tidak tercatat.',
          needsSplit: false,
          subtasks: [],
        },
        source: 'fallback',
        attempts: 0,
        latencyMs: 0,
      });
      const correction = await routing.addCorrection({
        decisionId: decision.id,
        fromRole,
        toRole: role,
        messageText: prompt,
      });

      const { sessionId, history } = await sessionFor(conversation, userMessage.id);
      const { run, assistantMessageId } = await db.transaction(async (tx) => {
        const [runRow] = await tx
          .insert(runs)
          .values({
            kind: 'chat',
            engine: 'hermes',
            model: userMessage.model,
            conversationId: conversation.id,
          })
          .returning();
        const assistantMessageId = uuidv7();
        await tx.insert(messages).values({
          id: assistantMessageId,
          conversationId: conversation.id,
          author: 'assistant',
          parts: [{ type: 'text', text: '' }],
          model: userMessage.model,
          runId: runRow!.id,
        });
        await tx
          .update(conversations)
          .set({ hermesSessionId: sessionId, updatedAt: new Date(now()) })
          .where(eq(conversations.id, conversation.id));
        return { run: runRow!, assistantMessageId };
      });

      runner.launch({
        run,
        conversationId: conversation.id,
        assistantMessageId,
        prompt: await agentPrompt(conversation, prompt, prompt),
        sessionId,
        ...(history.length ? { history } : {}),
        projectHistory: projectHistoryFor(conversation.id, userMessage.id),
        projectId: conversation.projectId,
        resolveRole: makeResolver({
          conversation,
          runId: run.id,
          userMessageId: userMessage.id,
          assistantMessageId,
          prompt,
          previousRole: null,
          manualRole: role,
        }),
      });

      return { run: toRunDto(run), correction: toCorrectionDto(correction) };
    },

    async editMessage(messageId, input) {
      const { message, conversation } = await editableMessage(messageId);
      if (message.author !== 'user') {
        throw new AppError(400, 'message_not_editable', 'Hanya pesan pengguna yang bisa diubah.');
      }
      // Pesan baru diperiksa dulu agar percakapan tidak terpotong lalu gagal terkirim.
      await composeInput(input);
      if (input.role) routing.assertRoleAllowed(input.role, conversation);
      await truncateFrom(message);
      return service.sendMessage(conversation.id, input);
    },

    async deleteMessage(messageId) {
      const { message } = await editableMessage(messageId);
      await truncateFrom(message);
    },

    async exists(id) {
      const [row] = await db
        .select({ id: conversations.id })
        .from(conversations)
        .where(eq(conversations.id, id));
      return !!row;
    },

    async idle() {
      await Promise.all([...background]);
    },
  };
  return service;
}
