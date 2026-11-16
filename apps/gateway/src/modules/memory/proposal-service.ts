import { IdSchema, type MemoryProposal, type MemoryProposalStatus } from '@aios/contracts';
import { aliasedTable, and, asc, count, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import {
  conversations,
  memories,
  memoryExtractions,
  memoryProposals,
  messages,
  schedules,
} from '../../db/schema/index.js';
import { AppError } from '../../errors.js';
import type { NineRouterClient } from '../llm/client.js';
import type { EventHub } from '../runs/hub.js';
import { keywordQuery } from '../spaces/service.js';
import {
  buildExtractPrompt,
  checkFact,
  CONTEXT_MEMORIES_MAX,
  DEFAULT_EXTRACT_DAILY_MAX,
  EXTRACT_SYSTEM_PROMPT,
  FACTS_PER_TURN,
  OWNER_MESSAGES_MAX,
  OWNER_TEXT_MAX,
  parseExtraction,
  PENDING_MAX,
  REJECTED_MEMORY_DAYS,
  worthExtracting,
  type AcceptedFact,
  type ContextMemory,
  type MemoryExtractMode,
  type OwnerMessage,
} from './extractor.js';
import { MAX_MEMORIES, memoryLimitReached } from './service.js';

/**
 * Usulan memori dari ekstraksi fakta (docs/DESIGN_MEMORI_SEMANTIK.md 4.4): menjadwalkan dan menjalankan ekstraksi
 * setelah run chat umum selesai, lalu tinjau, setujui, tolak, urungkan. Ekstraksi tidak pernah melempar ke runner:
 * kegagalan apa pun hanya dicatat (tanpa isi pesan) dan tidak mengubah hasil run.
 */
export interface MemoryProposalService {
  /** Mode yang berlaku (`MEMORY_EXTRACT_MODE`). */
  readonly mode: MemoryExtractMode;
  /** Dipanggil runner saat run chat umum dari pesan pemilik selesai. Mode off = tidak melakukan apa pun. */
  schedule(conversationId: string): Promise<void>;
  /** Pekerjaan `memory-extract`: satu panggilan model paling banyak. Mengembalikan jumlah usulan baru. */
  extract(conversationId: string): Promise<number>;
  list(query: { status?: MemoryProposalStatus | 'all' | undefined }): Promise<MemoryProposal[]>;
  approve(id: string, edits: { text?: string | undefined }): Promise<MemoryProposal>;
  reject(id: string): Promise<MemoryProposal>;
  undo(id: string): Promise<MemoryProposal>;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const LIST_MAX = 200;
const EXTRACT_TIMEOUT_MS = 20_000;
const EXTRACT_MAX_TOKENS = 600;
const NOTIFY_TEXT_MAX = 80;

type ProposalRow = typeof memoryProposals.$inferSelect;
type Executor = Pick<Database, 'select' | 'insert' | 'update' | 'delete'>;

const target = aliasedTable(memories, 'target');

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function toDto(row: ProposalRow, targetText: string | null): MemoryProposal {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    text: row.text,
    evidence: row.evidence,
    targetMemoryId: row.targetMemoryId,
    targetText,
    previousText: row.previousText,
    resultMemoryId: row.resultMemoryId,
    conversationId: row.conversationId,
    messageId: row.messageId,
    runId: row.runId,
    model: row.model,
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
  };
}

export function createMemoryProposalService(deps: {
  db: Database;
  hub: Pick<EventHub, 'publishLive'>;
  client: NineRouterClient;
  mode: MemoryExtractMode;
  model: string;
  /** Menaruh pekerjaan ekstraksi di antrean (pg-boss di produksi; langsung dijalankan di tes). */
  enqueue: (conversationId: string) => Promise<void>;
  dailyMax?: number | undefined;
  now?: () => number;
  log?: {
    info: (obj: object, msg: string) => void;
    warn: (obj: object, msg: string) => void;
  };
}): MemoryProposalService {
  const { db, hub, client, mode, model, enqueue, log } = deps;
  const now = deps.now ?? Date.now;
  const dailyMax = deps.dailyMax ?? DEFAULT_EXTRACT_DAILY_MAX;

  const notFound = () => new AppError(404, 'proposal_not_found', 'Usulan tidak ditemukan.');
  const decided = () =>
    new AppError(409, 'proposal_decided', 'Usulan ini sudah diputuskan; tidak bisa diubah lagi.');

  async function load(id: string): Promise<ProposalRow> {
    if (!IdSchema.safeParse(id).success) throw notFound();
    const [row] = await db.select().from(memoryProposals).where(eq(memoryProposals.id, id));
    if (!row) throw notFound();
    return row;
  }

  async function dtoOf(executor: Executor, id: string): Promise<MemoryProposal> {
    const [found] = await executor
      .select({ row: memoryProposals, targetText: target.text })
      .from(memoryProposals)
      .leftJoin(target, eq(target.id, memoryProposals.targetMemoryId))
      .where(eq(memoryProposals.id, id));
    if (!found) throw notFound();
    return toDto(found.row, found.targetText);
  }

  /** Chat umum saja: tanpa project, ruang, tim, dan bukan percakapan milik jadwal. */
  async function isGeneralChat(conversationId: string): Promise<boolean> {
    const [conversation] = await db
      .select({
        projectId: conversations.projectId,
        spaceId: conversations.spaceId,
        teamId: conversations.teamId,
      })
      .from(conversations)
      .where(eq(conversations.id, conversationId));
    if (!conversation || conversation.projectId || conversation.spaceId || conversation.teamId) {
      return false;
    }
    const [schedule] = await db
      .select({ id: schedules.id })
      .from(schedules)
      .where(eq(schedules.conversationId, conversationId))
      .limit(1);
    return !schedule;
  }

  /** Pesan pemilik terakhir (bagian teks saja, tanpa lampiran), terlama dulu. */
  async function ownerMessages(conversationId: string): Promise<OwnerMessage[]> {
    const rows = await db
      .select({ id: messages.id, runId: messages.runId, parts: messages.parts })
      .from(messages)
      .where(and(eq(messages.conversationId, conversationId), eq(messages.author, 'user')))
      .orderBy(desc(messages.id))
      .limit(OWNER_MESSAGES_MAX);
    return rows
      .map((row) => ({
        id: row.id,
        runId: row.runId,
        text: row.parts
          .flatMap((part) => (part.type === 'text' ? [part.text] : []))
          .join('\n\n')
          .trim()
          .slice(0, OWNER_TEXT_MAX),
      }))
      .filter((m) => m.text.length > 0)
      .reverse();
  }

  /** Memori yang paling cocok kata dengan pesan pemilik (untuk dedup dan `update`); bila tak ada, yang terbaru. */
  async function contextMemories(owner: readonly OwnerMessage[]): Promise<ContextMemory[]> {
    const query = keywordQuery(owner.map((m) => m.text).join('\n'));
    const ranked = query
      ? await db
          .select({ id: memories.id, text: memories.text })
          .from(memories)
          .where(sql`${memories.tsv} @@ to_tsquery('simple', ${query})`)
          .orderBy(
            desc(sql`ts_rank_cd(${memories.tsv}, to_tsquery('simple', ${query}))`),
            desc(memories.updatedAt),
          )
          .limit(CONTEXT_MEMORIES_MAX)
      : [];
    const rows = ranked.length
      ? ranked
      : await db
          .select({ id: memories.id, text: memories.text })
          .from(memories)
          .orderBy(desc(memories.updatedAt), asc(memories.id))
          .limit(CONTEXT_MEMORIES_MAX);
    return rows.map((row, i) => ({ ref: `m${i + 1}`, id: row.id, text: row.text }));
  }

  /** Teks pembanding duplikat: usulan menunggu, dan yang ditolak/diurungkan dalam 90 hari terakhir. */
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

  async function callModel(prompt: string): Promise<string> {
    const res = await client.request('/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      timeoutMs: EXTRACT_TIMEOUT_MS,
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: EXTRACT_MAX_TOKENS,
        stream: false,
        messages: [
          { role: 'system', content: EXTRACT_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
      }),
    });
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(`HTTP ${res.status}`);
    }
    const json = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('balasan tanpa isi');
    return content;
  }

  /** Mode auto: fakta langsung diterapkan; usulan dicatat `auto_saved` agar bisa diurungkan. */
  async function autoSave(fact: AcceptedFact, conversationId: string): Promise<boolean> {
    return db.transaction(async (tx) => {
      const at = new Date(now());
      const origin = {
        conversationId,
        messageId: fact.source.id,
        runId: fact.source.runId,
        model,
        evidence: fact.evidence,
      };
      if (fact.kind === 'add') {
        const [total] = await tx.select({ n: count() }).from(memories);
        if ((total?.n ?? 0) >= MAX_MEMORIES) return false;
        const [memory] = await tx
          .insert(memories)
          .values({
            text: fact.text,
            source: 'extracted',
            sourceConversationId: conversationId,
            sourceMessageId: fact.source.id,
          })
          .returning({ id: memories.id });
        await tx.insert(memoryProposals).values({
          ...origin,
          kind: 'add',
          status: 'auto_saved',
          text: fact.text,
          resultMemoryId: memory!.id,
          createdAt: at,
          decidedAt: at,
        });
        return true;
      }
      const [current] = await tx
        .select({ text: memories.text })
        .from(memories)
        .where(eq(memories.id, fact.target!.id))
        .for('update');
      if (!current) return false;
      await tx.update(memories).set({ text: fact.text }).where(eq(memories.id, fact.target!.id));
      await tx.insert(memoryProposals).values({
        ...origin,
        kind: 'update',
        status: 'auto_saved',
        text: fact.text,
        targetMemoryId: fact.target!.id,
        previousText: current.text,
        resultMemoryId: fact.target!.id,
        createdAt: at,
        decidedAt: at,
      });
      return true;
    });
  }

  return {
    mode,

    async schedule(conversationId) {
      if (mode === 'off') return;
      await enqueue(conversationId);
    },

    async extract(conversationId) {
      if (mode === 'off') return 0;
      if (!(await isGeneralChat(conversationId))) return 0;
      const owner = await ownerMessages(conversationId);
      const latest = owner.at(-1);
      if (!latest || !worthExtracting(latest.text)) return 0;

      const [pending] = await db
        .select({ n: count() })
        .from(memoryProposals)
        .where(eq(memoryProposals.status, 'pending'));
      if ((pending?.n ?? 0) >= PENDING_MAX) {
        log?.info({ conversationId, pending: pending?.n }, 'ekstraksi memori dilewati: usulan menunggu penuh');
        return 0;
      }
      const [calls] = await db
        .select({ n: count() })
        .from(memoryExtractions)
        .where(gt(memoryExtractions.createdAt, new Date(now() - DAY_MS)));
      if ((calls?.n ?? 0) >= dailyMax) {
        log?.warn({ conversationId, limit: dailyMax }, 'ekstraksi memori dilewati: batas harian tercapai');
        return 0;
      }

      const context = await contextMemories(owner);
      // Dicatat sebelum memanggil model: panggilan yang gagal tetap dihitung ke batas harian.
      const [call] = await db
        .insert(memoryExtractions)
        .values({ conversationId, outcome: 'failed', createdAt: new Date(now()) })
        .returning({ id: memoryExtractions.id });
      const finish = (outcome: 'ok' | 'invalid', proposals = 0) =>
        db
          .update(memoryExtractions)
          .set({ outcome, proposals })
          .where(eq(memoryExtractions.id, call!.id));

      let raw: string;
      try {
        raw = await callModel(buildExtractPrompt(owner, context));
      } catch (err) {
        log?.warn({ err, conversationId }, 'ekstraksi memori gagal memanggil model');
        return 0;
      }
      const facts = parseExtraction(raw);
      if (!facts) {
        // Isi keluaran tidak dicatat: bisa memuat teks pemilik.
        log?.warn({ conversationId }, 'keluaran ekstraksi memori tidak sah; dibuang');
        await finish('invalid');
        return 0;
      }

      const all = await db.select({ id: memories.id, text: memories.text }).from(memories);
      const seen = await proposalTexts();
      const accepted: AcceptedFact[] = [];
      for (const fact of facts) {
        if (accepted.length >= FACTS_PER_TURN) break;
        const result = checkFact(fact, {
          owner,
          context,
          memories: all,
          seen: [...seen, ...accepted.map((a) => a.text)],
        });
        if ('reject' in result) {
          log?.info({ conversationId, why: result.reject, rule: result.rule }, 'fakta memori dibuang');
          continue;
        }
        accepted.push(result.ok);
      }

      let saved = 0;
      for (const fact of accepted) {
        if (mode === 'auto') {
          if (await autoSave(fact, conversationId)) saved += 1;
          else log?.warn({ conversationId }, 'fakta memori tidak disimpan: batas memori atau target hilang');
          continue;
        }
        await db.insert(memoryProposals).values({
          kind: fact.kind,
          text: fact.text,
          evidence: fact.evidence,
          targetMemoryId: fact.target?.id ?? null,
          conversationId,
          messageId: fact.source.id,
          runId: fact.source.runId,
          model,
          createdAt: new Date(now()),
        });
        saved += 1;
      }
      await finish('ok', saved);
      if (saved > 0) {
        const first = accepted[0]!.text;
        hub.publishLive('user', {
          type: 'notification',
          level: 'info',
          topic: 'memory_proposal',
          ...(mode === 'auto'
            ? {
                title: `Disimpan ke memori: ${clip(first, NOTIFY_TEXT_MAX)}`,
                ...(saved > 1 ? { body: `${saved} fakta disimpan; bisa diurungkan di Memori.` } : {}),
              }
            : {
                title: saved > 1 ? `${saved} usulan memori baru` : 'Usulan memori baru',
                body: clip(first, NOTIFY_TEXT_MAX),
              }),
        });
        log?.info({ conversationId, saved, mode }, 'ekstraksi memori selesai');
      }
      return saved;
    },

    async list({ status = 'pending' }) {
      const rows = await db
        .select({ row: memoryProposals, targetText: target.text })
        .from(memoryProposals)
        .leftJoin(target, eq(target.id, memoryProposals.targetMemoryId))
        .where(status === 'all' ? undefined : eq(memoryProposals.status, status))
        .orderBy(desc(memoryProposals.createdAt), desc(memoryProposals.id))
        .limit(LIST_MAX);
      return rows.map((r) => toDto(r.row, r.targetText));
    },

    async approve(id, edits) {
      const row = await load(id);
      if (row.status !== 'pending') throw decided();
      return db.transaction(async (tx) => {
        // Klaim dulu di transaksi yang sama: persetujuan kedua yang bersamaan menunggu kunci baris ini, lalu
        // tidak menemukan status pending lagi (409). Galat apa pun di bawah membatalkan klaim.
        const [claimed] = await tx
          .update(memoryProposals)
          .set({ status: 'approved', decidedAt: new Date(now()) })
          .where(and(eq(memoryProposals.id, id), eq(memoryProposals.status, 'pending')))
          .returning({ id: memoryProposals.id });
        if (!claimed) throw decided();
        const text = edits.text ?? row.text;
        if (row.kind === 'add') {
          const [total] = await tx.select({ n: count() }).from(memories);
          if ((total?.n ?? 0) >= MAX_MEMORIES) throw memoryLimitReached();
          const [memory] = await tx
            .insert(memories)
            .values({
              text,
              source: 'extracted',
              sourceConversationId: row.conversationId,
              sourceMessageId: row.messageId,
            })
            .returning({ id: memories.id });
          await tx
            .update(memoryProposals)
            .set({ text, resultMemoryId: memory!.id })
            .where(eq(memoryProposals.id, id));
        } else {
          const [current] = row.targetMemoryId
            ? await tx
                .select({ id: memories.id, text: memories.text })
                .from(memories)
                .where(eq(memories.id, row.targetMemoryId))
                .for('update')
            : [];
          if (!current) {
            throw new AppError(
              409,
              'proposal_target_missing',
              'Memori yang akan diganti sudah dihapus. Tolak usulan ini atau tambahkan faktanya sendiri.',
            );
          }
          await tx.update(memories).set({ text }).where(eq(memories.id, current.id));
          await tx
            .update(memoryProposals)
            .set({ text, previousText: current.text, resultMemoryId: current.id })
            .where(eq(memoryProposals.id, id));
        }
        return dtoOf(tx, id);
      });
    },

    async reject(id) {
      await load(id);
      const [updated] = await db
        .update(memoryProposals)
        .set({ status: 'rejected', decidedAt: new Date(now()) })
        .where(and(eq(memoryProposals.id, id), eq(memoryProposals.status, 'pending')))
        .returning({ id: memoryProposals.id });
      if (!updated) throw decided();
      return dtoOf(db, id);
    },

    async undo(id) {
      const row = await load(id);
      if (row.status !== 'auto_saved') {
        throw new AppError(
          409,
          'proposal_not_undoable',
          'Hanya memori yang disimpan otomatis dan belum diurungkan yang bisa diurungkan.',
        );
      }
      return db.transaction(async (tx) => {
        const [claimed] = await tx
          .update(memoryProposals)
          .set({ status: 'undone', decidedAt: new Date(now()) })
          .where(and(eq(memoryProposals.id, id), eq(memoryProposals.status, 'auto_saved')))
          .returning({ id: memoryProposals.id });
        if (!claimed) throw decided();
        if (row.kind === 'add' && row.resultMemoryId) {
          await tx.delete(memories).where(eq(memories.id, row.resultMemoryId));
        }
        if (row.kind === 'update' && row.targetMemoryId && row.previousText !== null) {
          await tx
            .update(memories)
            .set({ text: row.previousText })
            .where(eq(memories.id, row.targetMemoryId));
        }
        return dtoOf(tx, id);
      });
    },
  };
}
