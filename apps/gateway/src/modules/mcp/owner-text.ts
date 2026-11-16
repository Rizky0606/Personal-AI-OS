import { and, eq } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { messages } from '../../db/schema/index.js';

/** Teks pesan pemilik yang memulai run (bagian teks saja); string kosong bila tidak ada. */
export function createOwnerText(db: Database): (runId: string) => Promise<string> {
  return async (runId) => {
    const rows = await db
      .select({ parts: messages.parts })
      .from(messages)
      .where(and(eq(messages.runId, runId), eq(messages.author, 'user')));
    return rows
      .flatMap((row) => row.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])))
      .join('\n');
  };
}
