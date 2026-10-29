import type { EventEnvelope, Run } from '@aios/contracts';
import {
  isSettled,
  newLiveRun,
  reduceLiveRun,
  withRunStart,
  type LiveRun,
  type RunFailure,
} from './liveRun';

export interface RunTrackerDeps {
  realtime: { subscribe(channel: string, handler: (envelope: EventEnvelope) => void): () => void };
  fetchRun: (id: string) => Promise<Run>;
  /** Dipanggil sekali per run saat statusnya final; di sini UI mengambil hasil akhir dari server. */
  onFinished: (run: LiveRun) => void;
  pollMs?: number;
}

export const RUN_POLL_MS = 15_000;

/**
 * Mengikuti run lewat channel `run:<id>` sejak seq 0 (replay penuh), terlepas dari layar mana yang sedang
 * terbuka: pindah percakapan atau layar tidak menghilangkan teks yang sudah mengalir. Polling status
 * menjadi jaring pengaman bila event penutup tidak pernah sampai (koneksi putus saat run selesai).
 */
export class RunTracker {
  private readonly runs = new Map<string, LiveRun>();
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly stops = new Map<string, () => void>();
  /** Run yang gagal di sesi ini; bertahan setelah [release] supaya errornya tetap tampil di percakapan. */
  private readonly failures = new Map<string, RunFailure>();
  private readonly pollMs: number;

  constructor(private readonly deps: RunTrackerDeps) {
    this.pollMs = deps.pollMs ?? RUN_POLL_MS;
  }

  /** Idempotent: run yang sudah dilacak tidak dilanggan dua kali. */
  track(runId: string): void {
    if (this.runs.has(runId)) return;
    this.runs.set(runId, newLiveRun(runId));
    const unsubscribe = this.deps.realtime.subscribe(`run:${runId}`, (envelope) => {
      this.apply(runId, (run) => reduceLiveRun(run, envelope.event, Date.parse(envelope.ts)));
    });
    const timer = setInterval(() => void this.poll(runId), this.pollMs);
    this.stops.set(runId, () => {
      unsubscribe();
      clearInterval(timer);
    });
    this.notify(runId);
  }

  get = (runId: string): LiveRun | undefined => this.runs.get(runId);

  failureOf = (runId: string): RunFailure | undefined => this.failures.get(runId);

  subscribe = (runId: string, listener: () => void): (() => void) => {
    let set = this.listeners.get(runId);
    if (!set) {
      set = new Set();
      this.listeners.set(runId, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  };

  /** Dilepas setelah UI menggantikannya dengan data server (pesan akhir). */
  release(runId: string): void {
    this.stops.get(runId)?.();
    this.stops.delete(runId);
    if (this.runs.delete(runId)) this.notify(runId);
  }

  /** Pesan run ini dihapus pemilik: lepas tampilannya dan lupakan galatnya. */
  forget(runId: string): void {
    this.failures.delete(runId);
    this.release(runId);
  }

  private async poll(runId: string): Promise<void> {
    const current = this.runs.get(runId);
    if (!current || isSettled(current.status)) return;
    try {
      const run = await this.deps.fetchRun(runId);
      this.apply(runId, (live) => {
        const settledAt = Date.parse(run.updatedAt);
        return withRunStart(
          {
            ...live,
            status: run.status,
            error: run.error ?? live.error,
            // Event penutup tidak pernah sampai: waktu selesai dari server supaya elapsed berhenti.
            endedAt:
              live.endedAt === null && isSettled(run.status) && Number.isFinite(settledAt)
                ? settledAt
                : live.endedAt,
          },
          Date.parse(run.createdAt),
        );
      });
    } catch {
      // Jaringan sedang bermasalah; percobaan berikutnya menyusul.
    }
  }

  private apply(runId: string, change: (run: LiveRun) => LiveRun): void {
    const before = this.runs.get(runId);
    if (!before) return;
    const after = change(before);
    if (after === before) return;
    this.runs.set(runId, after);
    const justFinished = !isSettled(before.status) && isSettled(after.status);
    if (justFinished) {
      this.stops.get(runId)?.();
      this.stops.delete(runId);
      if (after.status === 'failed') {
        this.failures.set(
          runId,
          after.error ?? { code: 'run_failed', message: '', retryable: false },
        );
      }
    }
    this.notify(runId);
    if (justFinished) this.deps.onFinished(after);
  }

  private notify(runId: string): void {
    this.listeners.get(runId)?.forEach((listener) => listener());
  }
}
