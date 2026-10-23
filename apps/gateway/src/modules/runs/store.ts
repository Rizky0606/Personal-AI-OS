import type { AgentEvent } from '@aios/contracts';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { runEvents } from '../../db/schema/index.js';
import type { EventHub } from './hub.js';

export interface StoredEvent {
  runId: string;
  seq: number;
  ts: string;
  event: AgentEvent;
}

export interface EventStore {
  /** Menyimpan event dengan seq berikutnya untuk run itu, lalu menyiarkannya ke `run:<id>`. */
  append(runId: string, event: AgentEvent): Promise<StoredEvent>;
  /** Event dengan seq > afterSeq, berurutan. */
  list(runId: string, afterSeq: number, limit: number): Promise<StoredEvent[]>;
  /** Seq terbesar yang tersimpan; 0 bila belum ada. */
  head(runId: string): Promise<number>;
}

export function createEventStore(db: Database, hub: EventHub): EventStore {
  /**
   * Penulisan event satu run diantrekan: seq dihitung dari `max(seq)`, jadi dua penulisan bersamaan akan
   * bertabrakan di primary key. Riset menulis dari beberapa pekerja paralel, jadi urutan harus dijamin di sini.
   */
  const tails = new Map<string, Promise<unknown>>();

  async function insert(runId: string, event: AgentEvent): Promise<StoredEvent> {
    // seq dihitung di SQL agar tetap benar setelah gateway restart; primary key (run_id, seq) menolak ganda.
    const result = await db.execute<{ seq: number; ts: Date }>(sql`
        insert into run_events (run_id, seq, type, payload)
        select ${runId}::uuid, coalesce(max(seq), 0) + 1, ${event.type}, ${JSON.stringify(event)}::jsonb
        from run_events where run_id = ${runId}::uuid
        returning seq, ts`);
    const row = result.rows[0];
    if (!row) throw new Error('run_events: insert tidak mengembalikan baris');
    const stored: StoredEvent = {
      runId,
      seq: Number(row.seq),
      ts: new Date(row.ts).toISOString(),
      event,
    };
    hub.publishStored(`run:${runId}`, { seq: stored.seq, ts: stored.ts, event });
    return stored;
  }

  return {
    append(runId, event) {
      const previous = tails.get(runId) ?? Promise.resolve();
      // Kegagalan penulisan sebelumnya tidak boleh memblokir penulisan berikutnya.
      const next = previous.catch(() => undefined).then(() => insert(runId, event));
      tails.set(runId, next);
      void next
        .then(
          () => undefined,
          () => undefined,
        )
        .then(() => {
          if (tails.get(runId) === next) tails.delete(runId);
        });
      return next;
    },

    async list(runId, afterSeq, limit) {
      const rows = await db
        .select()
        .from(runEvents)
        .where(and(eq(runEvents.runId, runId), gt(runEvents.seq, afterSeq)))
        .orderBy(asc(runEvents.seq))
        .limit(limit);
      return rows.map((r) => ({
        runId: r.runId,
        seq: r.seq,
        ts: r.ts.toISOString(),
        event: r.payload,
      }));
    },

    async head(runId) {
      const result = await db.execute<{ head: number }>(
        sql`select coalesce(max(seq), 0)::int as head from run_events where run_id = ${runId}::uuid`,
      );
      return Number(result.rows[0]?.head ?? 0);
    },
  };
}
