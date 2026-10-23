import { normalizeEvents, type AgentAdapter, type RunHandle } from '@aios/adapters';
import {
  TERMINAL_RUN_STATUSES,
  canTransition,
  type AgentEvent,
  type RunError,
  type RunStatus,
  type Usage,
} from '@aios/contracts';
import { and, eq, notInArray } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { messages, runs } from '../../db/schema/index.js';
import type { EventHub } from './hub.js';
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
  /** Memutuskan role (router atau pilihan manual) dan menyimpannya; dipanggil pada status `routing`. */
  resolveRole(signal: AbortSignal): Promise<ResolvedRole>;
}

export interface Runner {
  /** Menjalankan run di latar belakang; mengembalikan segera. Kegagalan dicatat sebagai event `error`. */
  launch(input: LaunchInput): void;
  /** Meminta run berhenti dan menunggu (maks. beberapa detik) sampai statusnya final. false bila tidak aktif. */
  cancel(runId: string): Promise<boolean>;
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
 * Mesin yang sudah bisa menjalankan run di gateway. `research` sementara dijalankan Hermes (engine riset
 * dibuat nanti); `omp` butuh worker Windows yang belum ada.
 */
const RUNNABLE_ENGINES = new Set(['hermes', 'research']);

const CANCEL_WAIT_MS = 5000;

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
    };

    const saveText = () =>
      db
        .update(messages)
        .set({ parts: [{ type: 'text', text }] })
        .where(eq(messages.id, input.assistantMessageId));

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
        if (engine && RUNNABLE_ENGINES.has(engine)) {
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
        const handle = await adapter.startRun({
          runId: run.id,
          messageId: input.assistantMessageId,
          prompt: input.prompt,
          // Dihitung per run: perubahan role di mode dev berlaku pada run berikutnya.
          systemPrompt: deps.roles.bundle(decision.role).systemPrompt,
          sessionId: input.sessionId,
          ...(run.model ? { model: run.model } : {}),
          signal: ctl.abort.signal,
        });
        ctl.handle = handle;
        if (ctl.cancelled) await handle.cancel();

        for await (const event of normalizeEvents(handle.events, (raw, issues) =>
          log?.warn(
            { runId: run.id, issues, type: (raw as { type?: unknown })?.type },
            'event adapter dibuang',
          ),
        )) {
          if (event.type === 'message.delta') text += event.text;
          if (event.type === 'message.completed' && event.usage) usage = event.usage;
          if (event.type === 'error') {
            failure = { code: event.code, message: event.message, retryable: event.retryable };
            continue;
          }
          if (event.type === 'run.completed') {
            // Baris DB final lebih dulu, supaya klien yang membaca REST setelah event ini melihat status akhir.
            completed = true;
            await saveText();
            await db
              .update(runs)
              .set({ status: 'completed', usage: event.usage ?? usage })
              .where(eq(runs.id, run.id));
            status = 'running';
          }
          await emit(event);
        }
      }

      if (completed) {
        // Status DB sudah 'completed'; event penutup menyusul sebagai event terakhir run.
        const stored = await emit({ type: 'run.status', status: 'completed' });
        status = 'completed';
        hub.publishLive(`conversation:${input.conversationId}`, stored.event);
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

    isActive: (runId) => active.has(runId),

    async recoverOrphans() {
      const orphans = await db
        .select()
        .from(runs)
        .where(and(eq(runs.kind, 'chat'), notInArray(runs.status, [...TERMINAL_RUN_STATUSES])));
      for (const run of orphans) {
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
      }
      return orphans.length;
    },

    async idle() {
      await Promise.all([...active.values()].map((c) => c.done));
    },
  };
}
