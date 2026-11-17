import { eq } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { runWebState } from '../../db/schema/index.js';

/** Keadaan anggaran web satu run yang disimpan (BL 920). */
export interface RunWebState {
  searches: number;
  reads: number;
  allowed: string[];
}

/** Penyimpanan anggaran web per run; dipakai `web-tools.ts` sebagai sumber kebenaran setelah restart. */
export interface WebRunStore {
  load(runId: string): Promise<RunWebState | null>;
  save(runId: string, state: RunWebState): Promise<void>;
}

export function createWebRunStore(db: Database): WebRunStore {
  return {
    async load(runId) {
      const [row] = await db
        .select({
          searches: runWebState.searches,
          reads: runWebState.reads,
          allowed: runWebState.allowed,
        })
        .from(runWebState)
        .where(eq(runWebState.runId, runId))
        .limit(1);
      return row ?? null;
    },
    async save(runId, state) {
      const updatedAt = new Date();
      await db
        .insert(runWebState)
        .values({ runId, ...state, updatedAt })
        .onConflictDoUpdate({
          target: runWebState.runId,
          set: { searches: state.searches, reads: state.reads, allowed: state.allowed, updatedAt },
        });
    },
  };
}
