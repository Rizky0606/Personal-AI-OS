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
import { TERMINAL_RUN_STATUSES } from '@aios/contracts';
import { and, desc, eq, isNotNull, isNull, lt, notInArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { Database } from '../../db/client.js';
import { conversations, messages, projects, runs } from '../../db/schema/index.js';
import { AppError } from '../../errors.js';
import { uuidv7 } from '../../lib/uuidv7.js';
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
    archived?: 'true' | 'false' | undefined;
  }): Promise<Page<Conversation>>;
  createConversation(input: z.infer<typeof CreateConversationRequestSchema>): Promise<Conversation>;
  updateConversation(
    id: string,
    patch: z.infer<typeof UpdateConversationRequestSchema>,
  ): Promise<Conversation>;
  archiveConversation(id: string): Promise<void>;
  listMessages(
    conversationId: string,
    q: { before?: string | undefined; limit: number },
  ): Promise<Page<Message>>;
  sendMessage(
    conversationId: string,
    input: z.infer<typeof SendMessageRequestSchema>,
    options?: { continueFromRunId?: string },
  ): Promise<{ message: Message; run: Run }>;
  /** Mengganti role pesan terakhir, mencatat koreksi, dan menjalankan ulang dengan role baru. */
  reroute(
    messageId: string,
    input: z.infer<typeof RerouteRequestSchema>,
  ): Promise<z.infer<typeof RerouteResponseSchema>>;
  exists(id: string): Promise<boolean>;
  /** Menunggu pekerjaan latar belakang (judul) selesai; untuk shutdown dan tes. */
  idle(): Promise<void>;
}

const notFound = () => new AppError(404, 'conversation_not_found', 'Percakapan tidak ditemukan.');
const MAX_TITLE_CHARS = 200;

export function createChatService(deps: {
  db: Database;
  runner: Runner;
  titles: TitleService;
  routing: RoutingService;
  /** Untuk menentukan mesin dari role. */
  roles: { get(roleId: string): { engine: string } | undefined };
  now?: () => number;
}): ChatService {
  const { db, runner, titles, routing, roles, now = Date.now } = deps;
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

  return {
    async listConversations(q) {
      const rows = await db
        .select()
        .from(conversations)
        .where(
          and(
            q.before ? lt(conversations.id, q.before) : undefined,
            q.projectId ? eq(conversations.projectId, q.projectId) : undefined,
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
      const [row] = await db
        .insert(conversations)
        .values({
          title: (input.title ?? '').trim().slice(0, MAX_TITLE_CHARS),
          surface: input.surface,
          projectId: input.projectId ?? null,
        })
        .returning();
      return toConversationDto(row!);
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
      if (input.parts.some((p) => p.type === 'file')) {
        throw new AppError(
          400,
          'files_not_supported',
          'Lampiran belum didukung untuk chat umum (Hermes tidak menerima berkas).',
        );
      }
      const prompt = textOf(input.parts);
      if (!prompt) throw new AppError(400, 'empty_message', 'Pesan tidak boleh kosong.');
      // Pilihan manual diperiksa sekarang (400) agar tidak baru gagal setelah run dimulai.
      if (input.role) routing.assertRoleAllowed(input.role, conversation);
      await assertNoActiveRun(conversationId);

      const previousRole = await previousRoleOf(conversationId);
      const sessionId = conversation.hermesSessionId ?? `aios-${conversation.id}`;
      const model = input.model ?? null;

      const { run, userMessage, assistantMessageId } = await db.transaction(async (tx) => {
        // Role belum diketahui: router memutuskannya pada status `routing` di dalam run.
        const [runRow] = await tx
          .insert(runs)
          .values({ kind: 'chat', engine: 'hermes', model, conversationId })
          .returning();
        const [userRow] = await tx
          .insert(messages)
          .values({
            conversationId,
            author: 'user',
            parts: input.parts,
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
        prompt,
        sessionId,
        projectId: conversation.projectId,
        ...(options?.continueFromRunId ? { continueFromRunId: options.continueFromRunId } : {}),
        resolveRole: makeResolver({
          conversation,
          runId: run.id,
          userMessageId: userMessage.id,
          assistantMessageId,
          prompt,
          previousRole,
          ...(input.role ? { manualRole: input.role } : {}),
        }),
      });

      if (conversation.title === '') {
        const job = autoTitle(conversationId, prompt).catch(() => undefined);
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

      const sessionId = conversation.hermesSessionId ?? `aios-${conversation.id}`;
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
          .set({ updatedAt: new Date(now()) })
          .where(eq(conversations.id, conversation.id));
        return { run: runRow!, assistantMessageId };
      });

      runner.launch({
        run,
        conversationId: conversation.id,
        assistantMessageId,
        prompt,
        sessionId,
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
}
