import {
  IdSchema,
  type SkillProposal,
  type SkillProposalBlock,
  type SkillDetail,
  type SkillProposalDetail,
} from '@aios/contracts';
import { and, desc, eq, gt, inArray } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { skillHermesSeen, skillProposals } from '../../db/schema/index.js';
import { AppError } from '../../errors.js';
import type { EventHub } from '../runs/hub.js';
import type { HermesSkillSource } from './hermes-skills.js';
import type { InstallService } from './install-service.js';
import { findingErrors, type SkillChange, type SkillManager } from './manager.js';
import { extractProposals } from './proposals.js';
import type { SkillsService } from './service.js';

/** Usulan skill: simpan, tinjau, setujui, tolak (P11). Tidak ada jalur yang mengaktifkan usulan tanpa `approve`. */
export type ProposalRow = typeof skillProposals.$inferSelect;

export interface ProposalEdits {
  name?: string | undefined;
  description?: string | undefined;
  body?: string | undefined;
  acknowledge?: boolean | undefined;
}

export interface ProposalService {
  /**
   * Dipanggil runner saat jawaban selesai: mengurai blok `aios-skill-proposal`, menyimpan usulan pending
   * (lewat pemindai), dan mengembalikan teks jawaban TANPA blok. Tidak pernah melempar: gagal menyimpan
   * usulan tidak boleh merusak jawaban.
   */
  capture(input: {
    text: string;
    runId: string;
    conversationId: string | null;
    messageId: string;
  }): Promise<string>;
  list(query: {
    status?: 'pending' | 'approved' | 'rejected' | 'all' | undefined;
    conversationId?: string | undefined;
  }): Promise<SkillProposal[]>;
  get(id: string): Promise<SkillProposalDetail>;
  approve(id: string, edits: ProposalEdits): Promise<SkillChange>;
  reject(id: string, reason: string | undefined): Promise<SkillProposal>;
  /**
   * Membandingkan daftar skill Hermes dengan yang pernah terlihat; skill baru (di luar `aios/`) menjadi usulan
   * "Hermes membuat skill baru". Run pertama hanya mencatat dasar tanpa membuat usulan. Mengembalikan jumlah usulan baru.
   */
  watchHermes(): Promise<number>;
}

/** Batas harian usulan dari agent (P11). Jendela bergulir 24 jam, bukan hari kalender. */
export const PROPOSALS_PER_DAY = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const BASELINE = '__baseline__';
const LIST_MAX = 200;

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function toProposalDto(row: ProposalRow): SkillProposal {
  return {
    id: row.id,
    kind: row.kind,
    origin: row.origin,
    targetId: row.targetId,
    hermesName: row.hermesName,
    name: row.name,
    description: row.description,
    reason: row.reason,
    status: row.status,
    scan: row.scan,
    conversationId: row.conversationId,
    runId: row.runId,
    messageId: row.messageId,
    createdAt: row.createdAt.toISOString(),
    decidedAt: iso(row.decidedAt),
    decisionNote: row.decisionNote,
    resultSkillId: row.resultSkillId,
  };
}

export function createProposalService(deps: {
  db: Database;
  skills: SkillsService;
  manager: SkillManager;
  installer?: InstallService | undefined;
  hermes?: HermesSkillSource | undefined;
  hub: Pick<EventHub, 'publishLive'>;
  now?: () => number;
  dailyLimit?: number;
  log?: {
    info: (obj: object, msg: string) => void;
    warn: (obj: object, msg: string) => void;
  };
}): ProposalService {
  const { db, skills, manager, installer, hermes, hub, log } = deps;
  const now = deps.now ?? Date.now;
  const dailyLimit = deps.dailyLimit ?? PROPOSALS_PER_DAY;

  const notFound = () => new AppError(404, 'proposal_not_found', 'Usulan tidak ditemukan.');
  const decided = () =>
    new AppError(409, 'proposal_decided', 'Usulan ini sudah diputuskan; tidak bisa diubah lagi.');

  const announce = (title: string) =>
    hub.publishLive('user', {
      type: 'notification',
      title,
      level: 'info',
      topic: 'skill_proposal',
    });

  async function load(id: string): Promise<ProposalRow> {
    if (!IdSchema.safeParse(id).success) throw notFound();
    const [row] = await db.select().from(skillProposals).where(eq(skillProposals.id, id));
    if (!row) throw notFound();
    return row;
  }

  /** Target usulan patch harus skill tambahan yang ada; skill bawaan repo tidak bisa ditambal. */
  function patchTarget(targetId: string | null): SkillDetail | undefined {
    const target = targetId ? skills.get(targetId) : undefined;
    return target && target.source !== 'builtin' ? target : undefined;
  }

  async function insertAgentProposal(
    block: SkillProposalBlock,
    ctx: { runId: string; conversationId: string | null; messageId: string },
  ): Promise<ProposalRow | null> {
    const since = new Date(now() - DAY_MS);
    const recent = await db
      .select({ id: skillProposals.id })
      .from(skillProposals)
      .where(and(eq(skillProposals.origin, 'agent'), gt(skillProposals.createdAt, since)));
    if (recent.length >= dailyLimit) {
      log?.warn(
        { runId: ctx.runId, limit: dailyLimit },
        'usulan skill dibuang: batas harian tercapai',
      );
      return null;
    }
    if (block.kind === 'patch' && !patchTarget(block.targetId ?? null)) {
      log?.warn(
        { runId: ctx.runId, targetId: block.targetId },
        'usulan patch dibuang: skill target tidak ada atau bawaan repo',
      );
      return null;
    }
    const scan = manager.scan({ body: block.body, description: block.description });
    const [row] = await db
      .insert(skillProposals)
      .values({
        kind: block.kind,
        origin: 'agent',
        targetId: block.kind === 'patch' ? (block.targetId ?? null) : null,
        name: block.name,
        description: block.description,
        body: block.body,
        reason: block.reason,
        scan,
        conversationId: ctx.conversationId,
        runId: ctx.runId,
        messageId: ctx.messageId,
        createdAt: new Date(now()),
      })
      .returning();
    return row ?? null;
  }

  const service: ProposalService = {
    async capture({ text, runId, conversationId, messageId }) {
      const extraction = extractProposals(text);
      if (extraction.found === 0) return text;
      for (const why of extraction.rejected) {
        log?.warn({ runId, why }, 'blok usulan skill diabaikan');
      }
      if (extraction.accepted) {
        try {
          const row = await insertAgentProposal(extraction.accepted, {
            runId,
            conversationId,
            messageId,
          });
          if (row) {
            announce(`Agent mengusulkan skill: ${row.name}`);
            log?.info({ runId, proposalId: row.id, kind: row.kind }, 'usulan skill disimpan');
          }
        } catch (err) {
          log?.warn({ err, runId }, 'usulan skill gagal disimpan; jawaban tetap utuh');
        }
      }
      return extraction.text;
    },

    async list({ status = 'pending', conversationId }) {
      const filters = [
        status === 'all' ? undefined : eq(skillProposals.status, status),
        conversationId && IdSchema.safeParse(conversationId).success
          ? eq(skillProposals.conversationId, conversationId)
          : undefined,
      ].filter((f) => f !== undefined);
      // conversationId yang bukan uuid tidak mungkin cocok dengan apa pun.
      if (conversationId && !IdSchema.safeParse(conversationId).success) return [];
      const rows = await db
        .select()
        .from(skillProposals)
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(desc(skillProposals.createdAt), desc(skillProposals.id))
        .limit(LIST_MAX);
      return rows.map(toProposalDto);
    },

    async get(id) {
      const row = await load(id);
      const dto = toProposalDto(row);
      if (row.origin === 'hermes') {
        const skill = row.hermesName ? await hermes?.read(row.hermesName) : undefined;
        const body = skill?.body ?? '';
        const scan = skill ? manager.scan({ body, description: skill.description }) : row.scan;
        return {
          ...dto,
          description: skill?.description ?? row.description,
          scan,
          body,
          existing: null,
          approvable: row.status === 'pending' && skill !== undefined,
          ...(row.status !== 'pending'
            ? { blockedReason: 'Usulan ini sudah diputuskan.' }
            : skill
              ? {}
              : { blockedReason: 'Skill tidak lagi ada di folder Hermes.' }),
        };
      }
      const target = row.kind === 'patch' ? patchTarget(row.targetId) : undefined;
      const existing = target
        ? {
            id: target.id,
            name: target.name,
            description: target.description,
            version: target.version,
            source: target.source,
            body: target.body,
          }
        : null;
      const blocked =
        row.status !== 'pending'
          ? 'Usulan ini sudah diputuskan.'
          : row.kind === 'patch' && !target
            ? 'Skill yang akan ditambal sudah tidak ada atau bawaan repo.'
            : undefined;
      return {
        ...dto,
        scan: manager.scan({ body: row.body, description: row.description }),
        body: row.body,
        existing,
        approvable: blocked === undefined,
        ...(blocked ? { blockedReason: blocked } : {}),
      };
    },

    async approve(id, edits) {
      const row = await load(id);
      if (row.status !== 'pending') throw decided();
      // Klaim dulu: dua klik bersamaan tidak boleh menerapkan usulan dua kali.
      const [claimed] = await db
        .update(skillProposals)
        .set({ status: 'approved', decidedAt: new Date(now()) })
        .where(and(eq(skillProposals.id, id), eq(skillProposals.status, 'pending')))
        .returning({ id: skillProposals.id });
      if (!claimed) throw decided();

      try {
        let change: SkillChange;
        let finalName = row.name;
        let finalDescription = row.description;
        let finalBody = row.body;
        if (row.origin === 'hermes') {
          if (!installer || !row.hermesName)
            throw new AppError(503, 'skills_unavailable', 'Impor Hermes tidak aktif.');
          if (edits.name || edits.description || edits.body)
            throw new AppError(
              400,
              'proposal_not_editable',
              'Usulan Hermes diimpor apa adanya; sunting dilakukan setelah diimpor.',
            );
          change = await installer.importHermes({
            name: row.hermesName,
            ...(edits.acknowledge ? { acknowledge: true } : {}),
          });
        } else {
          finalName = edits.name ?? row.name;
          finalDescription = edits.description ?? row.description;
          finalBody = edits.body ?? row.body;
          if (row.kind === 'new') {
            // Sumber `agent`: pemindai memblokir yang berbahaya dan meminta persetujuan untuk peringatan.
            change = await manager.create(
              {
                name: finalName,
                description: finalDescription,
                body: finalBody,
                ...(edits.acknowledge ? { acknowledge: true } : {}),
              },
              { source: 'agent', origin: `proposal:${row.id}`, actor: 'agent' },
            );
          } else {
            const target = patchTarget(row.targetId);
            if (!target || !row.targetId)
              throw new AppError(
                409,
                'proposal_target_missing',
                'Skill yang akan ditambal sudah tidak ada atau bawaan repo.',
              );
            // Isi usulan agent diperlakukan seperti skill dari luar walau skill target buatan sendiri.
            const scan = manager.scan({ body: finalBody, description: finalDescription });
            if (scan.verdict === 'dangerous')
              throw new AppError(
                422,
                'skill_scan_blocked',
                'Pemindai menemukan isi berbahaya; usulan agent tidak bisa disetujui. Sunting isinya dulu.',
                findingErrors(scan),
              );
            if (scan.verdict === 'warning' && !edits.acknowledge)
              throw new AppError(
                422,
                'skill_scan_confirm',
                'Pemindai memberi peringatan; periksa baris yang ditandai lalu setujui secara eksplisit (acknowledge).',
                findingErrors(scan),
              );
            change = await manager.update(
              row.targetId,
              {
                name: finalName,
                description: finalDescription,
                body: finalBody,
                ...(edits.acknowledge ? { acknowledge: true } : {}),
              },
              'agent',
            );
          }
        }
        await db
          .update(skillProposals)
          .set({
            name: finalName,
            description: finalDescription,
            body: row.origin === 'hermes' ? '' : finalBody,
            resultSkillId: change.id,
          })
          .where(eq(skillProposals.id, id));
        return change;
      } catch (err) {
        // Gagal: usulan kembali menunggu, tidak ada yang berubah di katalog.
        await db
          .update(skillProposals)
          .set({ status: 'pending', decidedAt: null })
          .where(eq(skillProposals.id, id));
        throw err;
      }
    },

    async reject(id, reason) {
      const row = await load(id);
      if (row.status !== 'pending') throw decided();
      const [updated] = await db
        .update(skillProposals)
        .set({
          status: 'rejected',
          decidedAt: new Date(now()),
          decisionNote: reason?.trim() ? reason.trim() : null,
        })
        .where(and(eq(skillProposals.id, id), eq(skillProposals.status, 'pending')))
        .returning();
      if (!updated) throw decided();
      return toProposalDto(updated);
    },

    async watchHermes() {
      if (!hermes?.readable) return 0;
      const found = await hermes.list();
      const names = found.items.map((i) => i.name);
      const seen = new Set(
        (await db.select({ name: skillHermesSeen.name }).from(skillHermesSeen)).map((r) => r.name),
      );
      if (!seen.has(BASELINE)) {
        // Run pertama: semua skill yang sudah ada adalah dasar, bukan "baru".
        await db
          .insert(skillHermesSeen)
          .values([...names, BASELINE].map((name) => ({ name, firstSeenAt: new Date(now()) })))
          .onConflictDoNothing();
        return 0;
      }
      const fresh = names.filter((n) => !seen.has(n));
      if (fresh.length === 0) return 0;
      await db
        .insert(skillHermesSeen)
        .values(fresh.map((name) => ({ name, firstSeenAt: new Date(now()) })))
        .onConflictDoNothing();
      const imported = new Set(
        skills
          .list({ include: 'all' })
          .filter((s) => s.source === 'installed' && s.origin?.startsWith('hermes:'))
          .map((s) => s.origin!.slice('hermes:'.length)),
      );
      const readable = new Set(found.readable);
      const already = new Set(
        (
          await db
            .select({ name: skillProposals.hermesName })
            .from(skillProposals)
            .where(
              and(eq(skillProposals.origin, 'hermes'), inArray(skillProposals.hermesName, fresh)),
            )
        ).map((r) => r.name),
      );
      let created = 0;
      for (const name of fresh) {
        if (imported.has(name) || already.has(name) || !readable.has(name)) continue;
        const skill = await hermes.read(name);
        if (!skill) continue;
        await db.insert(skillProposals).values({
          kind: 'new',
          origin: 'hermes',
          hermesName: name,
          name: skill.name,
          description: skill.description,
          reason: 'Hermes membuat skill baru di folder skill-nya.',
          scan: manager.scan({ body: skill.body, description: skill.description }),
          createdAt: new Date(now()),
        });
        created += 1;
        announce(`Hermes membuat skill baru: ${skill.name}`);
      }
      if (created > 0) log?.info({ created }, 'skill baru buatan Hermes menjadi usulan');
      return created;
    },
  };
  return service;
}
