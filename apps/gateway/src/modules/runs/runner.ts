import {
  AdapterError,
  normalizeEvents,
  type AgentAdapter,
  type RunHandle,
  type StartRunInput,
} from '@aios/adapters';
import {
  TERMINAL_RUN_STATUSES,
  canTransition,
  workerBranchFor,
  type AgentEvent,
  type MessagePart,
  type RunError,
  type RunStatus,
  type Usage,
} from '@aios/contracts';
import { and, count, eq, inArray, notInArray } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { approvals, messages, projects, runs } from '../../db/schema/index.js';
import type { EventHub } from './hub.js';
import type { RunObserver } from './observer.js';
import type { EventStore } from './store.js';

export type RunRow = typeof runs.$inferSelect;

/** Hasil routing yang dipakai run: dicatat sebagai event `route.decided`. */
export interface ResolvedRole {
  role: string;
  confidence: number;
  reason: string;
}

export interface LaunchInput {
  run: RunRow;
  conversationId: string;
  assistantMessageId: string;
  prompt: string;
  sessionId: string;
  /** Riwayat untuk sesi Hermes yang baru dibuat setelah percakapan dipotong (lihat StartRunInput.history). */
  history?: StartRunInput['history'];
  /** Riwayat percakapan untuk run coding di worker: omp memulai proses baru tiap run, jadi selalu dikirim. */
  projectHistory?: () => Promise<NonNullable<StartRunInput['history']>>;
  /** Gambar lampiran pesan ini untuk model vision. */
  images?: StartRunInput['images'];
  /** Project percakapan ini; wajib untuk role yang berjalan di worker (omp). */
  projectId: string | null;
  /** Revisi setelah komentar review: melanjutkan worktree dan branch run ini. */
  continueFromRunId?: string | undefined;
  /** Memutuskan role (router atau pilihan manual) dan menyimpannya; dipanggil pada status `routing`. */
  resolveRole(signal: AbortSignal): Promise<ResolvedRole>;
}

export interface Runner {
  /** Menjalankan run di latar belakang; mengembalikan segera. Kegagalan dicatat sebagai event `error`. */
  launch(input: LaunchInput): void;
  /** Meminta run berhenti dan menunggu (maks. beberapa detik) sampai statusnya final. false bila tidak aktif. */
  cancel(runId: string): Promise<boolean>;
  /** Meneruskan keputusan izin ke mesin. 'inactive': run tidak berjalan di gateway ini. */
  resolveApproval(
    runId: string,
    approvalId: string,
    decision: 'allow' | 'deny',
    remember: boolean,
  ): Promise<'ok' | 'inactive'>;
  /** Mengarahkan agent yang sedang berjalan. Melempar AdapterError bila mesin tidak mendukung. */
  steer(runId: string, text: string): Promise<'ok' | 'inactive'>;
  isActive(runId: string): boolean;
  /** Run chat yang tertinggal setelah gateway mati ditandai gagal. Mengembalikan jumlahnya. */
  recoverOrphans(): Promise<number>;
  /** Menunggu semua run aktif selesai (shutdown dan tes). */
  idle(): Promise<void>;
}

export interface RunnerDeps {
  db: Database;
  store: EventStore;
  hub: EventHub;
  adapter: AgentAdapter;
  /** Run coding (engine omp) dijalankan di worker Windows lewat relay; tanpa ini role omp tidak tersedia. */
  workerAdapter?: AgentAdapter;
  /** Diberi tahu tiap status atau diff run berubah (kartu kanban mengikuti run). */
  observer?: RunObserver;
  /** Bundel role (aturan perilaku + role + skill) yang disuntik sebagai pesan sistem. */
  roles: {
    bundle(roleId: string): { systemPrompt: string };
    get(roleId: string): { engine: string; model?: string } | undefined;
  };
  /** Memori pemilik (W17) yang ditambahkan ke pesan sistem setiap run; tanpa ini tidak ada memori. */
  memory?: { promptSection(): Promise<string> };
  /** Folder kiriman: berkas buatan agent di server ditempel ke jawaban saat run chat selesai. */
  outbox?: {
    promptFor(runId: string): string;
    collect(runId: string): Promise<Extract<MessagePart, { type: 'file' }>[]>;
  };
  /** Aturan project (W23) yang ditambahkan ke pesan sistem run di project itu. */
  projectRules?: { rulesSection(projectId: string): Promise<string> };
  log?: {
    warn: (obj: object, msg: string) => void;
    error: (obj: object, msg: string) => void;
  };
}

/**
 * Mesin yang berjalan di gateway. `research` sementara dijalankan Hermes (engine riset dibuat nanti);
 * `omp` berjalan di worker Windows dan ditangani terpisah (`workerAdapter`).
 */
const RUNNABLE_ENGINES = new Set(['hermes', 'research']);

const CANCEL_WAIT_MS = 5000;

/**
 * Aturan untuk run yang berjalan di server (Hermes), bukan run coding di PC: mesin di server punya alat tulis
 * berkas dan terminal, tetapi pemilik tidak bisa menjangkau sistem berkas server. Hasil berupa berkas harus sampai
 * lewat jawaban (blok kode berpath) supaya aplikasi bisa menyediakan Unduh ZIP.
 */
export const PLAN_RULE = [
  '# Mode rencana',
  'Pemilik meminta rencana dulu. Jangan mengubah berkas, membuat berkas, memasang paket, atau menjalankan perintah yang mengubah apa pun; semua izin tulis dan perintah akan ditolak. Kamu boleh membaca kode dan mencari.',
  'Tulis rencana bernomor: tujuan, berkas yang akan diubah, langkah kerja, risiko, dan cara memverifikasi. Tanyakan bila ada yang perlu dikonfirmasi. Pemilik akan menyetujui rencana ini sebelum kamu mengerjakannya.',
].join('\n');

/** Konteks run coding: folder project adalah dunia kerja agent; pertanyaan tentang project dijawab dari kodenya. */
export function projectRule(name: string, stack: string): string {
  return [
    '# Project yang sedang dikerjakan',
    `Kamu bekerja di project "${name}"${stack ? ` (stack: ${stack})` : ''}. Folder kerjamu adalah salinan project itu; semua pertanyaan dan permintaan pemilik di percakapan ini mengenai project tersebut kecuali ia jelas membahas hal lain.`,
    'Sebelum menjawab pertanyaan tentang project (isi kode, arsitektur, ide fitur, masalah, saran), baca dulu berkas yang relevan (struktur folder, README, package.json, kode terkait) lalu jawab berdasarkan apa yang benar-benar ada; sebut nama berkas yang kamu pakai. Untuk pertanyaan dan analisis jangan mengubah berkas. Untuk permintaan perubahan, ubah kodenya langsung. Bila pesan berisi tautan, baca isinya dan pakai sebagai bahan. Pertanyaan umum di luar project boleh dijawab dari pengetahuanmu.',
  ].join('\n');
}

/**
 * Saran lanjutan: aplikasi menyembunyikan blok ini dari teks jawaban dan menampilkannya sebagai tombol
 * (format dibaca `splitSuggestions` di desktop).
 */
export const SUGGEST_RULE = [
  '# Saran lanjutan',
  'Bila ada langkah lanjutan yang masuk akal, tutup jawabanmu dengan blok persis ini: 2 sampai 3 saran pendek (maks. 80 karakter), ditulis sebagai kalimat perintah dari sudut pandang pemilik, tanpa teks apa pun sesudahnya.',
  '[saran]',
  '- saran pertama',
  '- saran kedua',
  '[/saran]',
  'Jangan menulis blok ini untuk sapaan, pertanyaan balik, atau jawaban yang sudah tuntas.',
].join('\n');

export const SERVER_FILES_RULE = [
  '# Berkas untuk pemilik',
  'Kamu berjalan di server yang sistem berkasnya tidak bisa diakses pemilik. Jangan membuat berkas, folder, atau arsip (zip, tar, docx, dan sejenisnya) di server sebagai hasil untuk pemilik, kecuali di folder kiriman bila disebut di bawah, dan jangan pernah menjawab dengan path berkas di server.',
  'Bila pemilik meminta berkas, project, atau zip: tulis isi lengkap setiap berkas di jawaban, satu blok kode per berkas dengan path di baris pembuka (mis. ```jsx src/App.jsx), termasuk package.json dan konfigurasi. Aplikasi menampilkan tombol Unduh ZIP yang mengemas semua blok kode itu; sebut tombol itu sekali di akhir.',
  'Berkas biner (gambar, PDF, dokumen Office) tidak bisa ditulis di jawaban: simpan di folder kiriman bila tersedia; bila tidak ada, jelaskan singkat lalu berikan sumbernya dalam format teks (mis. HTML, Markdown, CSV, SVG).',
].join('\n');

async function* emptyEvents(): AsyncGenerator<AgentEvent> {
  // Tidak ada event: adapter gagal dimulai.
}

interface Active {
  cancelled: boolean;
  abort: AbortController;
  handle?: RunHandle;
  done: Promise<void>;
}

const textOf = (events: Iterable<AgentEvent>) => {
  let text = '';
  for (const e of events) if (e.type === 'message.delta') text += e.text;
  return text;
};

export function createRunner(deps: RunnerDeps): Runner {
  const { db, store, hub, adapter, log } = deps;
  const active = new Map<string, Active>();

  /**
   * Pesan sistem run: bundel role, memori pemilik, lalu aturan project (bila run di project). Bagian tambahan yang
   * gagal dimuat tidak menggagalkan run.
   */
  async function projectContext(projectId: string): Promise<string> {
    const [row] = await db.select().from(projects).where(eq(projects.id, projectId));
    if (!row) return '';
    return projectRule(row.name, [...row.stack.languages, ...row.stack.frameworks].join(', '));
  }

  async function systemPromptFor(
    roleId: string,
    projectId: string | null,
    onServer: boolean,
    runId: string,
    planOnly = false,
  ): Promise<string> {
    const bundle = deps.roles.bundle(roleId).systemPrompt;
    const extra = async (name: string, load: () => Promise<string> | undefined) => {
      try {
        return (await load()) ?? '';
      } catch (err) {
        log?.warn({ err }, `${name} gagal dimuat; run berjalan tanpanya`);
        return '';
      }
    };
    const memory = await extra('memori', () => deps.memory?.promptSection());
    const rules = projectId
      ? await extra('aturan project', () => deps.projectRules?.rulesSection(projectId))
      : '';
    const outbox = onServer && deps.outbox ? deps.outbox.promptFor(runId) : '';
    const project =
      !onServer && projectId ? await extra('konteks project', () => projectContext(projectId)) : '';
    return [
      bundle,
      project,
      SUGGEST_RULE,
      onServer ? SERVER_FILES_RULE : '',
      outbox,
      planOnly ? PLAN_RULE : '',
      memory,
      rules,
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  /** Run coding memakai riwayat percakapan penuh; chat Hermes hanya riwayat sesi baru (bila ada). */
  async function historyFor(input: LaunchInput, coding: boolean) {
    const history = coding && input.projectHistory ? await input.projectHistory() : input.history;
    return history?.length ? { history } : {};
  }

  async function execute(input: LaunchInput, ctl: Active): Promise<void> {
    const { run } = input;
    let status: RunStatus = 'queued';
    let text = '';
    let usage: Usage | null = null;
    let failure: RunError | undefined;
    let completed = false;
    let coding = false;
    // Diff terakhir dari worker. Run rencana dan run coding tanpa perubahan (mis. hanya menjawab pertanyaan)
    // tidak punya hasil untuk ditinjau: langsung selesai.
    let changed = false;
    const reviewable = () => coding && !run.planOnly && changed;
    /** Langkah tool run ini, disimpan sebagai bagian pesan asisten supaya tetap terlihat setelah dimuat ulang. */
    const toolParts = new Map<string, Extract<MessagePart, { type: 'tool' }>>();

    const emit = (event: AgentEvent) => store.append(run.id, event);

    /** Mengubah status sesuai diagram (canTransition), lalu menyiarkan `run.status`. */
    const advance = async (next: RunStatus, extra: Partial<RunRow> = {}) => {
      if (!canTransition(status, next)) {
        throw new Error(`transisi status tidak sah: ${status} -> ${next}`);
      }
      await db
        .update(runs)
        .set({ status: next, ...extra })
        .where(eq(runs.id, run.id));
      status = next;
      const stored = await emit({ type: 'run.status', status: next });
      hub.publishLive(`conversation:${input.conversationId}`, stored.event);
      deps.observer?.notify(run.id);
    };

    /** Berkas buatan agent (folder kiriman) yang ikut di jawaban, setelah teks. */
    let fileParts: Extract<MessagePart, { type: 'file' }>[] = [];
    const saveText = () =>
      db
        .update(messages)
        .set({ parts: [...toolParts.values(), { type: 'text', text }, ...fileParts] })
        .where(eq(messages.id, input.assistantMessageId));

    /** Mencatat pergantian izin; status run mengikuti: menunggu izin <-> berjalan. */
    const onApproval = async (event: AgentEvent) => {
      if (event.type === 'approval.requested') {
        await db
          .insert(approvals)
          .values({ id: event.approvalId, runId: run.id, kind: event.kind, detail: event.detail })
          .onConflictDoNothing();
        if (status === 'running') await advance('waiting_approval');
      } else if (event.type === 'approval.resolved') {
        await db
          .update(approvals)
          .set({
            status: event.decision === 'allow' ? 'allowed' : 'denied',
            remember: event.remember,
            decidedAt: new Date(),
          })
          .where(and(eq(approvals.id, event.approvalId), eq(approvals.status, 'pending')));
        const [pending] = await db
          .select({ n: count() })
          .from(approvals)
          .where(and(eq(approvals.runId, run.id), eq(approvals.status, 'pending')));
        if (status === 'waiting_approval' && (pending?.n ?? 0) === 0) await advance('running');
      }
    };

    try {
      const emitted = await emit({ type: 'run.status', status: 'queued' });
      hub.publishLive(`conversation:${input.conversationId}`, emitted.event);

      if (!ctl.cancelled) await advance('routing');

      let decision: ResolvedRole | undefined;
      if (!ctl.cancelled) {
        try {
          decision = await input.resolveRole(ctl.abort.signal);
        } catch (err) {
          // Dibatalkan saat router berjalan: bukan kegagalan.
          if (!ctl.cancelled) throw err;
        }
      }
      let runnable = false;
      if (decision && !ctl.cancelled) {
        await emit({
          type: 'route.decided',
          role: decision.role,
          confidence: decision.confidence,
          reason: decision.reason,
        });
        await advance('preparing');
        const engine = deps.roles.get(decision.role)?.engine;
        if (engine === 'omp') {
          if (!input.projectId) {
            failure = {
              code: 'project_required',
              message:
                'Role coding hanya bisa dipakai di percakapan project. Pilih project di aplikasi desktop lalu mulai chat dari sana.',
              retryable: false,
            };
          } else if (!deps.workerAdapter) {
            failure = {
              code: 'engine_unavailable',
              message: 'Worker Windows belum dikonfigurasi di gateway ini.',
              retryable: false,
            };
          } else {
            runnable = true;
            coding = true;
            // Revisi memakai branch run sebelumnya; run baru pertama kali memakai branch dari id-nya sendiri.
            const [previous] = input.continueFromRunId
              ? await db
                  .select({ branch: runs.branch })
                  .from(runs)
                  .where(eq(runs.id, input.continueFromRunId))
              : [];
            await db
              .update(runs)
              .set({
                kind: 'coding',
                engine: 'omp',
                branch: previous?.branch ?? workerBranchFor(run.id),
              })
              .where(eq(runs.id, run.id));
          }
        } else if (engine && RUNNABLE_ENGINES.has(engine)) {
          runnable = true;
        } else {
          failure = {
            code: 'engine_unavailable',
            message: `Role ${decision.role} berjalan di worker Windows (omp) yang belum tersedia. Pilih role lain atau jalankan dari aplikasi desktop.`,
            retryable: false,
          };
        }
      }
      if (runnable && !ctl.cancelled) await advance('running');

      if (runnable && decision && !ctl.cancelled) {
        const chosenRole = decision.role;
        // Mode rencana hanya berarti untuk run coding; di chat biasa dihiraukan.
        const planOnly = coding && run.planOnly;
        const startAdapter = coding ? deps.workerAdapter! : adapter;
        // "Model otomatis" di run coding: omp memakai combo 9Router milik role (mis. coding-main), bukan nama "default".
        const model = run.model ?? (coding ? deps.roles.get(chosenRole)?.model : undefined);
        let handle: RunHandle | undefined;
        try {
          handle = await startAdapter.startRun({
            runId: run.id,
            messageId: input.assistantMessageId,
            prompt: input.prompt,
            // Dihitung per run: perubahan role (mode dev) dan memori berlaku pada run berikutnya.
            systemPrompt: await systemPromptFor(
              chosenRole,
              input.projectId ?? null,
              !coding,
              run.id,
              planOnly,
            ),
            sessionId: input.sessionId,
            ...(await historyFor(input, coding)),
            ...(input.images?.length ? { images: input.images } : {}),
            ...(coding && input.projectId ? { projectId: input.projectId, role: chosenRole } : {}),
            ...(coding && input.continueFromRunId
              ? { continueFromRunId: input.continueFromRunId }
              : {}),
            ...(planOnly ? { planOnly: true } : {}),
            ...(model ? { model } : {}),
            signal: ctl.abort.signal,
          });
        } catch (err) {
          // Gagal memulai dengan sebab yang jelas (mis. worker offline) menjadi alasan run gagal.
          if (!(err instanceof AdapterError)) throw err;
          failure = { code: err.code, message: err.message, retryable: err.retryable };
        }
        if (handle) {
          ctl.handle = handle;
          if (ctl.cancelled) await handle.cancel();
        }

        for await (const event of normalizeEvents(handle?.events ?? emptyEvents(), (raw, issues) =>
          log?.warn(
            { runId: run.id, issues, type: (raw as { type?: unknown })?.type },
            'event adapter dibuang',
          ),
        )) {
          if (event.type === 'message.delta') text += event.text;
          if (event.type === 'tool.started') {
            toolParts.set(event.toolCallId, {
              type: 'tool',
              toolCallId: event.toolCallId,
              name: event.name,
              ...(event.target ? { target: event.target } : {}),
              status: 'running',
            });
          }
          if (event.type === 'tool.finished') {
            const part = toolParts.get(event.toolCallId);
            if (part) {
              part.status = event.status;
              part.durationMs = event.durationMs;
            }
          }
          if (event.type === 'message.completed' && event.usage) usage = event.usage;
          if (event.type === 'error') {
            failure = { code: event.code, message: event.message, retryable: event.retryable };
            continue;
          }
          if (event.type === 'run.completed') {
            // Baris DB final lebih dulu, supaya klien yang membaca REST setelah event ini melihat status akhir.
            completed = true;
            if (!coding && deps.outbox) {
              try {
                fileParts = await deps.outbox.collect(run.id);
              } catch (err) {
                log?.warn({ err, runId: run.id }, 'folder kiriman gagal dibaca');
              }
            }
            await saveText();
            // Run coding berhenti di needs_review (menunggu tinjauan diff); run chat langsung selesai.
            await db
              .update(runs)
              .set({
                status: reviewable() ? 'needs_review' : 'completed',
                usage: event.usage ?? usage,
              })
              .where(eq(runs.id, run.id));
            status = 'running';
          }
          await emit(event);
          if (event.type === 'diff.updated') {
            changed = event.files.length > 0;
            deps.observer?.notify(run.id);
          }
          if (event.type === 'approval.requested' || event.type === 'approval.resolved') {
            await onApproval(event);
          }
        }
      }

      if (completed) {
        // Status DB sudah 'completed'; event penutup menyusul sebagai event terakhir run.
        const finalStatus: RunStatus = reviewable() ? 'needs_review' : 'completed';
        const stored = await emit({ type: 'run.status', status: finalStatus });
        status = finalStatus;
        hub.publishLive(`conversation:${input.conversationId}`, stored.event);
        deps.observer?.notify(run.id);
      } else if (ctl.cancelled) {
        await saveText();
        await advance('cancelled', { usage });
      } else {
        failure ??= {
          code: 'adapter_ended_early',
          message: 'Mesin agent berhenti tanpa menyelesaikan jawaban.',
          retryable: true,
        };
        await saveText();
        await emit({ type: 'error', ...failure });
        await advance('failed', { error: failure, usage });
      }
    } catch (err) {
      log?.error({ err, runId: run.id }, 'run gagal tak terduga');
      try {
        failure = {
          code: 'internal_error',
          message: 'Run gagal karena kesalahan di gateway.',
          retryable: true,
        };
        await saveText();
        if (canTransition(status, 'failed')) {
          await emit({ type: 'error', ...failure });
          await advance('failed', { error: failure, usage });
        }
      } catch (inner) {
        log?.error({ err: inner, runId: run.id }, 'gagal menandai run sebagai failed');
      }
    }
  }

  return {
    launch(input) {
      const ctl: Active = {
        cancelled: false,
        abort: new AbortController(),
        done: Promise.resolve(),
      };
      ctl.done = execute(input, ctl).finally(() => {
        active.delete(input.run.id);
      });
      active.set(input.run.id, ctl);
    },

    async cancel(runId) {
      const ctl = active.get(runId);
      if (!ctl) return false;
      ctl.cancelled = true;
      ctl.abort.abort();
      await ctl.handle?.cancel();
      await Promise.race([ctl.done, new Promise((r) => setTimeout(r, CANCEL_WAIT_MS))]);
      return true;
    },

    async resolveApproval(runId, approvalId, decision, remember) {
      const handle = active.get(runId)?.handle;
      if (!handle) return 'inactive';
      await handle.resolveApproval(approvalId, decision, remember);
      return 'ok';
    },

    async steer(runId, text) {
      const handle = active.get(runId)?.handle;
      if (!handle) return 'inactive';
      await handle.steer(text);
      return 'ok';
    },

    isActive: (runId) => active.has(runId),

    async recoverOrphans() {
      const orphans = await db
        .select()
        .from(runs)
        .where(
          and(
            inArray(runs.kind, ['chat', 'coding']),
            // needs_review adalah keadaan stabil (menunggu manusia), bukan run yang menggantung.
            notInArray(runs.status, [...TERMINAL_RUN_STATUSES, 'needs_review']),
          ),
        );
      for (const run of orphans) {
        await db
          .update(approvals)
          .set({ status: 'cancelled', decidedAt: new Date() })
          .where(and(eq(approvals.runId, run.id), eq(approvals.status, 'pending')));
        const events = await store.list(run.id, 0, 100_000);
        const text = textOf(events.map((e) => e.event));
        await db
          .update(messages)
          .set({ parts: [{ type: 'text', text }] })
          .where(and(eq(messages.runId, run.id), eq(messages.author, 'assistant')));
        const error: RunError = {
          code: 'gateway_restarted',
          message: 'Gateway dimulai ulang saat run berjalan. Kirim ulang pesan.',
          retryable: true,
        };
        await db.update(runs).set({ status: 'failed', error }).where(eq(runs.id, run.id));
        await store.append(run.id, { type: 'error', ...error });
        await store.append(run.id, { type: 'run.status', status: 'failed' });
        deps.observer?.notify(run.id);
      }
      return orphans.length;
    },

    async idle() {
      await Promise.all([...active.values()].map((c) => c.done));
    },
  };
}
