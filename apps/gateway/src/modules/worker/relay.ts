import { AdapterError, type WorkerRelayPort } from '@aios/adapters';
import type { AgentEvent, WorkerCommand, WorkerReviewResultFrame } from '@aios/contracts';
import type { ProjectsService } from '../projects/service.js';
import type { WorkerHub } from './routes.js';

export type FeedResult = 'ok' | 'not_active' | 'not_owned';

export interface WorkerRelay extends WorkerRelayPort {
  /** Event dari WebSocket worker diteruskan ke run yang mendengarkan. */
  feed(deviceId: string, runId: string, event: AgentEvent): FeedResult;
  /** Worker tersambung atau terputus; run yang berjalan di perangkat itu diberi tahu. */
  presence(deviceId: string, online: boolean): void;
  /** Meminta worker menerapkan keputusan review dan menunggu jawabannya. */
  review(
    projectId: string,
    command: Extract<WorkerCommand, { type: 'review.apply' }>,
  ): Promise<WorkerReviewResultFrame>;
  /** Jawaban `review.apply` dari worker. */
  reviewResult(deviceId: string, frame: WorkerReviewResultFrame): void;
}

const REVIEW_TIMEOUT_MS = 30_000;

interface Listener {
  deviceId: string;
  onEvent: (event: AgentEvent) => void;
  onDisconnect: () => void;
  onReconnect: () => void;
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

    presence(deviceId, online) {
      for (const entry of listeners.values()) {
        if (entry.deviceId !== deviceId) continue;
        if (online) entry.onReconnect();
        else entry.onDisconnect();
      }
    },
  };
}
