import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { conversations, messages } from '../../db/schema/index.js';
import { HERMES_EVIDENCE_WINDOW_MS } from '../memory/agent-proposals.js';

/** Pesan pemilik terbaru di chat umum yang dibaca untuk Hermes (tanpa run). */
const HERMES_OWNER_MESSAGES = 5;

/**
 * Teks pesan pemilik (bagian teks saja) yang boleh dirujuk tool: pesan yang memulai run (worker), atau untuk Hermes
 * (tanpa run) pesan pemilik di chat umum selama `HERMES_EVIDENCE_WINDOW_MS` terakhir. String kosong bila tidak ada.
 */
export function createOwnerText(
  db: Database,
  now: () => number = Date.now,
): (ctx: { runId: string | null }) => Promise<string> {
  return async ({ runId }) => {
    const rows = runId
      ? await db
          .select({ parts: messages.parts })
          .from(messages)
          .where(and(eq(messages.runId, runId), eq(messages.author, 'user')))
      : await db
          .select({ parts: messages.parts })
          .from(messages)
          .innerJoin(conversations, eq(conversations.id, messages.conversationId))
          .where(
            and(
              eq(messages.author, 'user'),
              gt(messages.createdAt, new Date(now() - HERMES_EVIDENCE_WINDOW_MS)),
              isNull(conversations.projectId),
              isNull(conversations.spaceId),
              isNull(conversations.teamId),
            ),
          )
          .orderBy(desc(messages.id))
          .limit(HERMES_OWNER_MESSAGES);
    return rows
      .flatMap((row) => row.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])))
      .join('\n');
  };
}
