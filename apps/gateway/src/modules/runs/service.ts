import { AdapterError } from '@aios/adapters';
import { TERMINAL_RUN_STATUSES, type Approval, type Run } from '@aios/contracts';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { approvals, runs } from '../../db/schema/index.js';
import { AppError } from '../../errors.js';
import { writeAudit } from '../audit/repo.js';
import { toApprovalDto, toRunDto } from '../chat/dto.js';
import type { Runner } from './runner.js';
import type { EventStore, StoredEvent } from './store.js';

export interface RunsService {
  get(id: string): Promise<Run>;
  events(
    id: string,
    afterSeq: number,
    limit: number,
  ): Promise<{ items: StoredEvent[]; lastSeq: number }>;
  cancel(id: string): Promise<Run>;
  /** Keputusan pengguna atas permintaan izin; diteruskan ke mesin (worker) yang menunggunya. */
  resolveApproval(
    actorDeviceId: string,
    runId: string,
    approvalId: string,
    input: { decision: 'allow' | 'deny'; remember: boolean },
  ): Promise<Approval>;
  /** Mengarahkan agent yang sedang berjalan dengan teks baru. */
  steer(runId: string, text: string): Promise<void>;
  /** Ada tidaknya run; dipakai WebSocket sebelum berlangganan. */
  exists(id: string): Promise<boolean>;
}

const notFound = () => new AppError(404, 'run_not_found', 'Run tidak ditemukan.');

export function createRunsService(deps: {
  db: Database;
  store: EventStore;
  runner: Runner;
}): RunsService {
  const { db, store, runner } = deps;

  async function load(id: string) {
    const [row] = await db.select().from(runs).where(eq(runs.id, id));
    if (!row) throw notFound();
    return row;
  }

  return {
    async get(id) {
      return toRunDto(await load(id));
    },

    async events(id, afterSeq, limit) {
      await load(id);
      const items = await store.list(id, afterSeq, limit);
      return { items, lastSeq: items.at(-1)?.seq ?? afterSeq };
    },

    async cancel(id) {
      const run = await load(id);
      if (TERMINAL_RUN_STATUSES.includes(run.status)) {
        throw new AppError(409, 'run_not_active', `Run sudah ${run.status}.`);
      }
      if (!(await runner.cancel(id))) {
        // Tidak ada di memori tetapi belum final: sisa dari gateway yang mati (recoverOrphans menanganinya).
        throw new AppError(409, 'run_not_active', 'Run ini tidak sedang berjalan di gateway.');
      }
      return toRunDto(await load(id));
    },

    async resolveApproval(actorDeviceId, runId, approvalId, { decision, remember }) {
      const [row] = await db
        .select()
        .from(approvals)
        .where(and(eq(approvals.id, approvalId), eq(approvals.runId, runId)));
      if (!row) throw new AppError(404, 'approval_not_found', 'Permintaan izin tidak ditemukan.');
      if (row.status !== 'pending') {
        throw new AppError(
          409,
          'approval_already_resolved',
          'Permintaan izin ini sudah diputuskan.',
        );
      }
      try {
        const outcome = await runner.resolveApproval(runId, approvalId, decision, remember);
        if (outcome === 'inactive') {
          throw new AppError(409, 'run_not_active', 'Run ini tidak sedang berjalan di gateway.');
        }
      } catch (error) {
        if (error instanceof AdapterError) {
          throw new AppError(error.retryable ? 503 : 409, error.code, error.message);
        }
        throw error;
      }
      const [updated] = await db
        .update(approvals)
        .set({
          status: decision === 'allow' ? 'allowed' : 'denied',
          remember: decision === 'allow' && remember,
          decidedAt: new Date(),
        })
        .where(and(eq(approvals.id, approvalId), eq(approvals.status, 'pending')))
        .returning();
      await writeAudit(db, {
        actorDeviceId,
        action: 'approval.decided',
        target: `approval:${approvalId} ${decision}${remember ? ' remember' : ''}`,
      });
      return toApprovalDto(updated ?? row);
    },

    async steer(runId, text) {
      await load(runId);
      try {
        if ((await runner.steer(runId, text)) === 'inactive') {
          throw new AppError(409, 'run_not_active', 'Run ini tidak sedang berjalan di gateway.');
        }
      } catch (error) {
        if (error instanceof AdapterError) {
          throw new AppError(error.retryable ? 503 : 409, error.code, error.message);
        }
        throw error;
      }
    },

    async exists(id) {
      const [row] = await db.select({ id: runs.id }).from(runs).where(eq(runs.id, id));
      return !!row;
    },
  };
}
