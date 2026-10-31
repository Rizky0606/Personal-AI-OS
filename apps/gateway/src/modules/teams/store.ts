import type { TeamEvent } from '@aios/contracts';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { teamEvents } from '../../db/schema/index.js';
import type { EventHub } from '../runs/hub.js';

export interface TeamEventStore {
  append(teamId: string, event: TeamEvent): Promise<void>;
  list(
    teamId: string,
    afterSeq: number,
    limit: number,
  ): Promise<{ seq: number; ts: string; event: TeamEvent }[]>;
  head(teamId: string): Promise<number>;
}

export function createTeamEventStore(db: Database, hub: EventHub): TeamEventStore {
  const tails = new Map<string, Promise<unknown>>();
  async function insert(teamId: string, event: TeamEvent) {
    const row = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${teamId}))`);
      const result = await tx.execute<{ seq: number; ts: Date }>(sql`
        insert into team_events (team_id, seq, type, payload)
        select ${teamId}::uuid, coalesce(max(seq), 0) + 1, ${event.type}, ${JSON.stringify(event)}::jsonb
        from team_events where team_id = ${teamId}::uuid returning seq, ts`);
      return result.rows[0];
    });
    if (!row) throw new Error('team_events: insert tidak mengembalikan baris');
    hub.publishStored(`team:${teamId}`, {
      seq: Number(row.seq),
      ts: new Date(row.ts).toISOString(),
      event,
    });
  }
  return {
    append(teamId, event) {
      const previous = tails.get(teamId) ?? Promise.resolve();
      const next = previous.catch(() => undefined).then(() => insert(teamId, event));
      tails.set(teamId, next);
      void next
        .finally(() => {
          if (tails.get(teamId) === next) tails.delete(teamId);
        })
        .catch(() => undefined);
      return next;
    },
    async list(teamId, afterSeq, limit) {
      return (
        await db
          .select()
          .from(teamEvents)
          .where(and(eq(teamEvents.teamId, teamId), gt(teamEvents.seq, afterSeq)))
          .orderBy(asc(teamEvents.seq))
          .limit(limit)
      ).map((row) => ({ seq: row.seq, ts: row.ts.toISOString(), event: row.payload }));
    },
    async head(teamId) {
      const rows = await db
        .select({ seq: teamEvents.seq })
        .from(teamEvents)
        .where(eq(teamEvents.teamId, teamId))
        .orderBy(asc(teamEvents.seq));
      return rows.at(-1)?.seq ?? 0;
    },
  };
}
