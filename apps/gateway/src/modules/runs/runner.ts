import { AdapterError, normalizeEvents, type AgentAdapter, type RunHandle } from '@aios/adapters';
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
import { approvals, messages, runs } from '../../db/schema/index.js';
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
    get(roleId: string): { engine: string } | undefined;
  };
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

  async function execute(input: LaunchInput, ctl: Active): Promise<void> {
    const { run } = input;
    let status: RunStatus = 'queued';
    let text = '';
    let usage: Usage | null = null;
    let failure: RunError | undefined;
    let completed = false;
    let coding = false;
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

    const saveText = () =>
      db
        .update(messages)
        .set({ parts: [...toolParts.values(), { type: 'text', text }] })
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
        const startAdapter = coding ? deps.workerAdapter! : adapter;
        let handle: RunHandle | undefined;
        try {
          handle = await startAdapter.startRun({
            runId: run.id,
            messageId: input.assistantMessageId,
            prompt: input.prompt,
            // Dihitung per run: perubahan role di mode dev berlaku pada run berikutnya.
            systemPrompt: deps.roles.bundle(chosenRole).systemPrompt,
            sessionId: input.sessionId,
            ...(coding && input.projectId ? { projectId: input.projectId, role: chosenRole } : {}),
            ...(coding && input.continueFromRunId
              ? { continueFromRunId: input.continueFromRunId }
              : {}),
            ...(run.model ? { model: run.model } : {}),
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
            await saveText();
            // Run coding berhenti di needs_review (menunggu tinjauan diff); run chat langsung selesai.
            await db
              .update(runs)
              .set({ status: coding ? 'needs_review' : 'completed', usage: event.usage ?? usage })
              .where(eq(runs.id, run.id));
            status = 'running';
          }
          await emit(event);
          if (event.type === 'diff.updated') deps.observer?.notify(run.id);
          if (event.type === 'approval.requested' || event.type === 'approval.resolved') {
            await onApproval(event);
          }
        }
      }

      if (completed) {
        // Status DB sudah 'completed'; event penutup menyusul sebagai event terakhir run.
        const finalStatus: RunStatus = coding ? 'needs_review' : 'completed';
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
