import { ADAPTERS_VERSION } from '@aios/adapters';
import type { StatusSchema } from '@aios/contracts';
import { and, count, desc, eq, isNull, notInArray } from 'drizzle-orm';
import type { z } from 'zod';
import type { Database } from '../../db/client.js';
import { devices, runs } from '../../db/schema/index.js';
import { GATEWAY_VERSION } from '../../version.js';
import type { HealthService } from '../health/service.js';

type Status = z.infer<typeof StatusSchema>;

export interface StatusService {
  get(): Promise<Status>;
}

/** Bagian pg-boss yang dibaca: ringkasan antrean. */
export interface QueueStats {
  getQueues(): Promise<
    { name: string; queuedCount: number; activeCount: number; failedCount: number }[]
  >;
}

export function createStatusService(deps: {
  db: Database;
  health: HealthService;
  isWorkerOnline: (deviceId: string) => boolean;
  queues?: QueueStats | undefined;
  now?: () => number;
  startedAt?: number;
}): StatusService {
  const now = deps.now ?? Date.now;
  const startedAt = deps.startedAt ?? now();

  return {
    async get() {
      const [readiness, workerRows, activeRows, jobs] = await Promise.all([
        deps.health.readiness(),
        deps.db
          .select({ id: devices.id, name: devices.name, lastSeenAt: devices.lastSeenAt })
          .from(devices)
          .where(and(eq(devices.kind, 'worker'), isNull(devices.revokedAt)))
          .orderBy(desc(devices.createdAt)),
        deps.db
          .select({ n: count() })
          .from(runs)
          // needs_review menunggu manusia, bukan pekerjaan yang berjalan.
          .where(
            notInArray(runs.status, [
              'completed',
              'failed',
              'cancelled',
              'accepted',
              'rejected',
              'needs_review',
            ]),
          ),
        deps.queues?.getQueues().catch(() => []) ?? Promise.resolve([]),
      ]);
      return {
        gateway: {
          version: GATEWAY_VERSION,
          adaptersVersion: ADAPTERS_VERSION,
          node: process.version,
          uptimeSec: Math.max(0, Math.round((now() - startedAt) / 1000)),
        },
        readiness,
        workers: workerRows.map((w) => ({
          deviceId: w.id,
          name: w.name,
          online: deps.isWorkerOnline(w.id),
          lastSeenAt: w.lastSeenAt?.toISOString() ?? null,
        })),
        jobs: jobs.map((q) => ({
          queue: q.name,
          queued: q.queuedCount,
          active: q.activeCount,
          failed: q.failedCount,
        })),
        activeRuns: activeRows[0]?.n ?? 0,
      };
    },
  };
}
