import { AdapterError, WORKER_REPLACED_MESSAGE, type WorkerRelayPort } from '@aios/adapters';
import type { AgentEvent, WorkerCommand, WorkerReviewResultFrame } from '@aios/contracts';
import type { ProjectsService } from '../projects/service.js';
import type { WorkerHub } from './routes.js';

export type FeedResult = 'ok' | 'not_active' | 'not_owned';

export interface WorkerRelay extends WorkerRelayPort {
  /** Event dari WebSocket worker diteruskan ke run yang mendengarkan. */
  feed(deviceId: string, runId: string, event: AgentEvent): FeedResult;
  /** Worker tersambung atau terputus; run yang berjalan di perangkat itu diberi tahu. */
  presence(deviceId: string, online: boolean): void;
  /**
   * Daftar run yang dipegang worker (frame `runs.active`, dikirim setiap tersambung). Run yang menunggu konfirmasi
   * (koneksinya sempat putus atau workernya diganti) dan tidak ada di daftar diakhiri seketika.
   */
  activeRuns(deviceId: string, runIds: readonly string[]): void;
  /** Meminta worker menerapkan keputusan review dan menunggu jawabannya. */
  review(
    projectId: string,
    command: Extract<WorkerCommand, { type: 'review.apply' }>,
  ): Promise<WorkerReviewResultFrame>;
  /** Jawaban `review.apply` dari worker. */
  reviewResult(deviceId: string, frame: WorkerReviewResultFrame): void;
  /**
   * Worker lama diganti worker baru (didaftarkan ulang dengan nama sama, project ikut pindah): run yang sedang
   * didengarkan dan tinjauan yang menunggu jawaban atas perangkat lama kini milik perangkat baru. Run itu tidak
   * dianggap tersambung kembali hanya karena perangkat baru online: worker baru harus membuktikan memegangnya
   * (`runs.active` atau event run itu); kalau tidak, run gagal `worker_replaced` (seketika saat worker baru melapor,
   * paling lambat setelah masa tunggu putus).
   */
  moveDevice(fromIds: readonly string[], toId: string): void;
}

const REVIEW_TIMEOUT_MS = 30_000;

interface Listener {
  deviceId: string;
  onEvent: (event: AgentEvent) => void;
  onDisconnect: (replaced?: boolean) => void;
  onReconnect: () => void;
  /**
   * Sejak run ini dikirim, koneksi worker-nya sempat putus (`disconnected`) atau workernya diganti (`replaced`):
   * worker yang sekarang belum tentu memegangnya. Hilang saat worker membuktikan memegang run itu.
   */
  unconfirmed?: 'disconnected' | 'replaced';
}

/** Worker yang tersambung tidak memegang run yang ditunggu: proses mesinnya hilang bersama worker sebelumnya. */
function lostEvent(reason: 'disconnected' | 'replaced'): AgentEvent {
  return reason === 'replaced'
    ? { type: 'error', code: 'worker_replaced', message: WORKER_REPLACED_MESSAGE, retryable: true }
    : {
        type: 'error',
        code: 'worker_restarted',
        message:
          'Worker dimulai ulang saat run berjalan, jadi run ini tidak bisa dilanjutkan. Jalankan ulang.',
        retryable: true,
      };
}

/** Worker terbukti memegang run: masa tunggu putus dihentikan. */
function confirm(entry: Listener): void {
  if (!entry.unconfirmed) return;
  entry.unconfirmed = undefined;
  entry.onReconnect();
}

/**
 * Penghubung antara runner di gateway dan worker: mengirim perintah ke worker pemilik project dan
 * mengantarkan event dari worker ke run yang menunggunya. Event hanya diterima dari perangkat yang
 * memang pemilik project run itu (ditetapkan saat `listen`), jadi worker lain tidak bisa menyusupkan event.
 */
export function createWorkerRelay(deps: {
  hub: Pick<WorkerHub, 'send' | 'isOnline'>;
  projects: Pick<ProjectsService, 'workerOf'>;
  reviewTimeoutMs?: number;
}): WorkerRelay {
  const listeners = new Map<string, Listener>();
  const reviews = new Map<
    string,
    {
      deviceId: string;
      timer: ReturnType<typeof setTimeout>;
      resolve: (frame: WorkerReviewResultFrame) => void;
    }
  >();

  async function deviceFor(projectId: string): Promise<string> {
    const deviceId = await deps.projects.workerOf(projectId);
    if (!deviceId) throw new AdapterError('project_not_found', 'Project tidak ditemukan.');
    return deviceId;
  }

  return {
    async send(projectId, command) {
      const deviceId = await deviceFor(projectId);
      if (!deps.hub.send(deviceId, command)) {
        throw new AdapterError(
          'worker_offline',
          'Worker belum tersambung. Buka aplikasi desktop di PC project ini lalu coba lagi.',
          true,
        );
      }
      // `run.start` baru saja terkirim lewat koneksi yang hidup: putus/ganti sebelumnya tidak berlaku bagi run ini.
      if (command.type === 'run.start') {
        const entry = listeners.get(command.runId);
        if (entry?.deviceId === deviceId) confirm(entry);
      }
    },

    async listen(runId, projectId, handlers) {
      const deviceId = await deviceFor(projectId);
      const entry: Listener = { deviceId, ...handlers };
      listeners.set(runId, entry);
      return () => {
        if (listeners.get(runId) === entry) listeners.delete(runId);
      };
    },

    feed(deviceId, runId, event) {
      const entry = listeners.get(runId);
      if (!entry) return 'not_active';
      if (entry.deviceId !== deviceId) return 'not_owned';
      // Worker yang sekarang mengirim event run ini: ia memegangnya (mis. proses yang sama dengan sesi baru).
      confirm(entry);
      entry.onEvent(event);
      return 'ok';
    },

    async review(projectId, command) {
      const deviceId = await deviceFor(projectId);
      if (reviews.has(command.runId)) {
        throw new AdapterError('review_in_progress', 'Tinjauan run ini sedang diproses.');
      }
      return new Promise<WorkerReviewResultFrame>((resolve, reject) => {
        const timer = setTimeout(() => {
          reviews.delete(command.runId);
          reject(
            new AdapterError(
              'review_timeout',
              'Worker tidak menjawab tinjauan tepat waktu. Coba lagi.',
              true,
            ),
          );
        }, deps.reviewTimeoutMs ?? REVIEW_TIMEOUT_MS);
        reviews.set(command.runId, { deviceId, timer, resolve });
        if (!deps.hub.send(deviceId, command)) {
          clearTimeout(timer);
          reviews.delete(command.runId);
          reject(
            new AdapterError(
              'worker_offline',
              'Worker belum tersambung. Buka aplikasi desktop di PC project ini lalu coba lagi.',
              true,
            ),
          );
        }
      });
    },

    reviewResult(deviceId, frame) {
      const pending = reviews.get(frame.runId);
      if (pending?.deviceId !== deviceId) return;
      clearTimeout(pending.timer);
      reviews.delete(frame.runId);
      pending.resolve(frame);
    },

    moveDevice(fromIds, toId) {
      for (const entry of listeners.values()) {
        if (!fromIds.includes(entry.deviceId)) continue;
        entry.deviceId = toId;
        entry.unconfirmed = 'replaced';
        entry.onDisconnect(true);
      }
      for (const pending of reviews.values()) {
        if (fromIds.includes(pending.deviceId)) pending.deviceId = toId;
      }
    },

    presence(deviceId, online) {
      for (const entry of listeners.values()) {
        // Run atas worker yang diganti hanya pulih lewat bukti dari worker baru (activeRuns/feed), bukan presence.
        if (entry.deviceId !== deviceId || entry.unconfirmed === 'replaced') continue;
        if (online) {
          // Worker versi lama tidak mengirim `runs.active`: koneksi pulih tetap menghentikan masa tunggu seperti dulu.
          entry.onReconnect();
        } else {
          entry.unconfirmed = 'disconnected';
          entry.onDisconnect();
        }
      }
    },

    activeRuns(deviceId, runIds) {
      for (const [runId, entry] of listeners) {
        if (entry.deviceId !== deviceId || !entry.unconfirmed) continue;
        if (runIds.includes(runId)) confirm(entry);
        else entry.onEvent(lostEvent(entry.unconfirmed));
      }
    },
  };
}
