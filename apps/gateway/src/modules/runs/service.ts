import { TERMINAL_RUN_STATUSES, type Run } from '@aios/contracts';
import { eq } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { runs } from '../../db/schema/index.js';
import { AppError } from '../../errors.js';
import { toRunDto } from '../chat/dto.js';
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

    async exists(id) {
      const [row] = await db.select({ id: runs.id }).from(runs).where(eq(runs.id, id));
      return !!row;
    },
  };
}
