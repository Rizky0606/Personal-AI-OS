import type { ProposalAgent } from '@aios/contracts';
import { and, count, desc, eq, gt, inArray, isNull } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { conversations, memories, memoryProposals, messages } from '../../db/schema/index.js';
import type { EventHub } from '../runs/hub.js';
import {
  checkFact,
  OWNER_MESSAGES_MAX,
  OWNER_TEXT_MAX,
  PENDING_MAX,
  REJECTED_MEMORY_DAYS,
  type FactRejection,
  type OwnerMessage,
} from './extractor.js';
import { MAX_MEMORIES } from './service.js';

/**
 * Usulan memori dari agent (tool `memory_propose`, docs/DESIGN_MCP_TOOLS.md bagian 17). Memakai tabel dan penjaga
 * yang sama dengan ekstraksi fakta: kutipan harus muncul apa adanya di pesan pemilik, pemindai injeksi, rahasia,
 * bentuk satu kalimat, duplikat (memori, usulan menunggu, yang ditolak 90 hari), dan batas usulan menunggu.
 * Tinjauannya lewat `/memories/proposals` yang sudah ada; tidak ada memori yang dibuat di sini.
 */
export interface AgentMemoryProposals {
  propose(input: AgentMemoryInput): Promise<AgentMemoryResult>;
}

export interface AgentMemoryInput {
  text: string;
  evidence: string;
  agent: ProposalAgent;
  /** Run yang memanggil (omp lewat worker); null untuk Hermes. */
  runId: string | null;
  conversationId: string | null;
  /** Model run (atau nama mesin), disimpan di kolom `model`. */
  model: string;
  afterWeb: boolean;
}

export type AgentMemoryRejection = FactRejection | 'pending_full' | 'memory_full';
export type AgentMemoryResult =
  { ok: { id: string } } | { reject: AgentMemoryRejection; rule?: string | undefined };

/** Hermes tanpa run: kutipan dicocokkan dengan pesan pemilik di chat umum selama ini. */
export const HERMES_EVIDENCE_WINDOW_MS = 30 * 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const NOTIFY_TEXT_MAX = 80;

export function createAgentMemoryProposals(deps: {
  db: Database;
  hub: Pick<EventHub, 'publishLive'>;
  now?: () => number;
}): AgentMemoryProposals {
  const { db, hub } = deps;
  const now = deps.now ?? Date.now;

  const toOwner = (rows: { id: string; runId: string | null; parts: unknown }[]) =>
    rows
      .map((row) => ({
        id: row.id,
        runId: row.runId,
        text: (row.parts as { type: string; text?: string }[])
          .flatMap((part) => (part.type === 'text' && part.text ? [part.text] : []))
          .join('\n\n')
          .trim()
          .slice(0, OWNER_TEXT_MAX),
      }))
      .filter((m) => m.text.length > 0)
      .reverse();

  /** Pesan pemilik yang boleh dikutip: pesan yang memulai run, atau (Hermes) pesan chat umum terbaru. */
  async function ownerMessages(runId: string | null): Promise<OwnerMessage[]> {
    const fields = { id: messages.id, runId: messages.runId, parts: messages.parts };
    if (runId) {
      return toOwner(
        await db
          .select(fields)
          .from(messages)
          .where(and(eq(messages.runId, runId), eq(messages.author, 'user')))
          .orderBy(desc(messages.id))
          .limit(OWNER_MESSAGES_MAX),
      );
    }
    return toOwner(
      await db
        .select(fields)
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
        .limit(OWNER_MESSAGES_MAX),
    );
  }

  /** Pembanding duplikat yang sama dengan ekstraksi: usulan menunggu, dan yang ditolak/diurungkan 90 hari terakhir. */
  async function proposalTexts(): Promise<string[]> {
    const since = new Date(now() - REJECTED_MEMORY_DAYS * DAY_MS);
    const [pending, refused] = await Promise.all([
      db
        .select({ text: memoryProposals.text })
        .from(memoryProposals)
        .where(eq(memoryProposals.status, 'pending')),
      db
        .select({ text: memoryProposals.text })
        .from(memoryProposals)
        .where(
          and(
            inArray(memoryProposals.status, ['rejected', 'undone']),
            gt(memoryProposals.createdAt, since),
          ),
        ),
    ]);
    return [...pending, ...refused].map((r) => r.text);
  }

  return {
    async propose(input) {
      const [pending] = await db
        .select({ n: count() })
        .from(memoryProposals)
        .where(eq(memoryProposals.status, 'pending'));
      if ((pending?.n ?? 0) >= PENDING_MAX) return { reject: 'pending_full' };
      const [total] = await db.select({ n: count() }).from(memories);
      if ((total?.n ?? 0) >= MAX_MEMORIES) return { reject: 'memory_full' };

      const owner = await ownerMessages(input.runId);
      const all = await db.select({ id: memories.id, text: memories.text }).from(memories);
      const result = checkFact(
        { action: 'add', text: input.text, evidence: input.evidence },
        { owner, context: [], memories: all, seen: await proposalTexts() },
      );
      if ('reject' in result) return result;

      const fact = result.ok;
      const [row] = await db
        .insert(memoryProposals)
        .values({
          kind: 'add',
          text: fact.text,
          evidence: fact.evidence,
          conversationId: input.conversationId,
          messageId: fact.source.id,
          runId: input.runId,
          model: input.model,
          source: 'agent',
          agent: input.agent,
          afterWeb: input.afterWeb,
          createdAt: new Date(now()),
        })
        .returning({ id: memoryProposals.id });
      hub.publishLive('user', {
        type: 'notification',
        level: 'info',
        topic: 'memory_proposal',
        title: 'Agent mengusulkan memori',
        body:
          fact.text.length > NOTIFY_TEXT_MAX
            ? `${fact.text.slice(0, NOTIFY_TEXT_MAX - 1)}…`
            : fact.text,
      });
      return { ok: { id: row!.id } };
    },
  };
}
