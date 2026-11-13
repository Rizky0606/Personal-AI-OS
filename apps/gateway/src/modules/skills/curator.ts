import {
  SkillCuratorReportSchema,
  type SkillCuratorReport,
  type SkillSource,
} from '@aios/contracts';
import { desc, gt, lt, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { skillCuratorReports, skillOpens, skillProposals } from '../../db/schema/index.js';
import { uuidv7 } from '../../lib/uuidv7.js';
import type { EventHub } from '../runs/hub.js';
import type { SkillManager } from './manager.js';
import type { SkillsService } from './service.js';

/**
 * Kurator skill (P11): dijalankan mingguan lewat pg-boss (lihat `jobs.ts`), atau manual dari halaman Skill.
 * Aturan keras: TIDAK PERNAH menghapus (hanya mengarsipkan, bisa dipulihkan), tidak menyentuh skill bawaan dan yang
 * disematkan, skill buatan sendiri hanya ditandai, dan saran gabung tidak pernah menggabungkan apa pun.
 */
export const STALE_DAYS = 30;
export const ARCHIVE_DAYS = 90;
export const REPORT_WINDOW_DAYS = 7;
/** Skill yang baru dibuat belum punya kesempatan dibuka; jangan dilaporkan "tidak pernah dibuka" dulu. */
export const NEVER_OPENED_MIN_AGE_DAYS = 7;
export const MERGE_SIMILARITY = 0.6;
const OPENS_RETENTION_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;
const LIST_CAP = { mostUsed: 5, neverOpened: 10, merge: 5 } as const;

/* ---------- Kemiripan deskripsi: kata biasa, tanpa model, tanpa dependensi ---------- */

const STOPWORDS = new Set(
  (
    'saat ketika sebelum setelah bila jika untuk yang dan atau dari dengan pada dalam itu ini ada akan juga ' +
    'agar supaya tanpa lebih hanya setiap semua satu dua sudah belum tidak bukan oleh para ' +
    'the and for with when use using that this from into your you are not any all per via'
  ).split(' '),
);

/** Kata bermakna dari satu deskripsi: huruf kecil, minimal 3 huruf, bukan kata sambung. */
export function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 3 && !STOPWORDS.has(word)),
  );
}

/** Ukuran Jaccard (irisan / gabungan) dua himpunan kata, 0..1. */
export function similarity(a: string, b: string): number {
  const left = tokens(a);
  const right = tokens(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/* ---------- Aturan umur ---------- */

export type CuratorAction = 'none' | 'stale' | 'archive';

/** Hari penuh sejak aktivitas terakhir. */
export const daysSince = (from: Date, now: Date): number =>
  Math.max(0, Math.floor((now.getTime() - from.getTime()) / DAY_MS));

/**
 * Keputusan kurator untuk satu skill tambahan. Hanya skill aktif yang tidak disematkan; bawaan repo tidak
 * pernah sampai ke sini. `installed` (dipasang pengguna dari luar) juga tidak disentuh.
 */
export function classify(input: {
  source: Exclude<SkillSource, 'builtin'>;
  pinned: boolean;
  status: 'active' | 'disabled' | 'archived';
  lastActivity: Date;
  now: Date;
}): { days: number; action: CuratorAction } {
  const days = daysSince(input.lastActivity, input.now);
  if (input.pinned || input.status !== 'active') return { days, action: 'none' };
  if (input.source === 'agent') {
    if (days >= ARCHIVE_DAYS) return { days, action: 'archive' };
    return { days, action: days >= STALE_DAYS ? 'stale' : 'none' };
  }
  if (input.source === 'user') return { days, action: days >= STALE_DAYS ? 'stale' : 'none' };
  return { days, action: 'none' };
}

/* ---------- Layanan ---------- */

export interface SkillCurator {
  /** Menjalankan satu putaran: menandai, mengarsipkan, menyusun laporan, menyimpan, dan memberi tahu. */
  runOnce(): Promise<SkillCuratorReport>;
  /** Laporan terakhir yang tersimpan; null bila belum pernah berjalan. */
  latest(): Promise<SkillCuratorReport | null>;
}

export function createSkillCurator(deps: {
  db: Database;
  skills: SkillsService;
  manager: SkillManager;
  hub: Pick<EventHub, 'publishLive'>;
  now?: () => number;
  log?: { info: (obj: object, msg: string) => void; warn: (obj: object, msg: string) => void };
}): SkillCurator {
  const { db, skills, manager, hub, log } = deps;
  const now = deps.now ?? Date.now;

  async function runOnce(): Promise<SkillCuratorReport> {
    const at = new Date(now());
    const windowStart = new Date(at.getTime() - REPORT_WINDOW_DAYS * DAY_MS);

    // Catatan dibuka per skill: terakhir kali, dan jumlah dalam jendela laporan.
    const lastOpened = new Map<string, Date>();
    const everOpened = new Set<string>();
    const opens = await db
      .select({
        id: skillOpens.skillId,
        last: sql<Date>`max(${skillOpens.openedAt})`.mapWith((v) => new Date(v as string)),
      })
      .from(skillOpens)
      .groupBy(skillOpens.skillId);
    for (const row of opens) {
      lastOpened.set(row.id, row.last);
      everOpened.add(row.id);
    }
    const inWindow = new Map<string, number>();
    const recent = await db
      .select({ id: skillOpens.skillId, n: sql<number>`count(*)::int` })
      .from(skillOpens)
      .where(gt(skillOpens.openedAt, windowStart))
      .groupBy(skillOpens.skillId);
    for (const row of recent) inWindow.set(row.id, row.n);

    const markedStale: SkillCuratorReport['markedStale'] = [];
    const archived: SkillCuratorReport['archived'] = [];
    const neverOpened: SkillCuratorReport['neverOpened'] = [];

    for (const extra of manager.extras()) {
      const created = new Date(extra.createdAt);
      const restored = extra.restoredAt ? new Date(extra.restoredAt) : undefined;
      const times = [created, restored, lastOpened.get(extra.id)].filter(
        (t): t is Date => t !== undefined,
      );
      const lastActivity = new Date(Math.max(...times.map((t) => t.getTime())));
      const ref = { id: extra.id, name: extra.name };

      if (extra.status === 'active' && !everOpened.has(extra.id)) {
        if (daysSince(created, at) >= NEVER_OPENED_MIN_AGE_DAYS) neverOpened.push(ref);
      }

      const { days, action } = classify({
        source: extra.source,
        pinned: extra.pinned,
        status: extra.status,
        lastActivity,
        now: at,
      });
      try {
        if (action === 'archive') {
          if (!extra.staleAt) await manager.markStale(extra.id, at);
          await manager.setStatus(extra.id, 'archived');
          archived.push({ ...ref, days });
        } else if (action === 'stale') {
          if (!extra.staleAt) {
            await manager.markStale(extra.id, at);
            markedStale.push({ ...ref, days });
          }
        } else if (extra.staleAt && extra.status === 'active' && !extra.pinned) {
          // Dibuka lagi (atau dipulihkan) sejak ditandai: tanda usangnya tidak berlaku lagi.
          await manager.markStale(extra.id, null);
        }
      } catch (err) {
        log?.warn({ err, skillId: extra.id }, 'kurator gagal memproses satu skill');
      }
    }

    // Skill yang paling sering dibuka minggu ini (termasuk bawaan: namanya tetap berguna untuk pemilik).
    const names = new Map(skills.list({ include: 'all' }).map((s) => [s.id, s.name] as const));
    const mostUsed = [...inWindow.entries()]
      .filter(([id]) => names.has(id))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, LIST_CAP.mostUsed)
      .map(([id, n]) => ({ id, name: names.get(id)!, opens: n }));

    // Saran gabung: pasangan yang deskripsinya sangat mirip; minimal satu bisa diubah pemilik.
    const active = skills.list({ include: 'active' });
    const pairs: SkillCuratorReport['mergeSuggestions'] = [];
    for (let i = 0; i < active.length; i += 1) {
      for (let j = i + 1; j < active.length; j += 1) {
        const a = active[i]!;
        const b = active[j]!;
        if (a.source === 'builtin' && b.source === 'builtin') continue;
        const score = similarity(a.description, b.description);
        if (score >= MERGE_SIMILARITY) {
          pairs.push({
            a: { id: a.id, name: a.name },
            b: { id: b.id, name: b.name },
            similarity: Math.round(score * 100) / 100,
          });
        }
      }
    }
    pairs.sort((x, y) => y.similarity - x.similarity || x.a.id.localeCompare(y.a.id));

    const [pending] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(skillProposals)
      .where(sql`${skillProposals.status} = 'pending'`);
    const pendingProposals = pending?.n ?? 0;

    const mergeSuggestions = pairs.slice(0, LIST_CAP.merge);
    const never = neverOpened.slice(0, LIST_CAP.neverOpened);
    const lines = [
      mostUsed.length
        ? `Paling sering dibuka: ${mostUsed.map((m) => `${m.name} (${m.opens}x)`).join(', ')}.`
        : 'Belum ada skill yang dibuka agent minggu ini.',
      never.length
        ? `Belum pernah dibuka: ${never.map((n) => n.name).join(', ')} (deskripsinya mungkin kurang jelas).`
        : null,
      pendingProposals ? `Usulan menunggu keputusan: ${pendingProposals}.` : null,
      markedStale.length ? `Ditandai usang: ${markedStale.map((m) => m.name).join(', ')}.` : null,
      archived.length
        ? `Diarsipkan (bisa dipulihkan): ${archived.map((m) => m.name).join(', ')}.`
        : null,
      mergeSuggestions.length
        ? `Saran gabung: ${mergeSuggestions.map((m) => `${m.a.name} + ${m.b.name}`).join('; ')}.`
        : null,
    ].filter((line): line is string => line !== null);

    const report: SkillCuratorReport = SkillCuratorReportSchema.parse({
      id: uuidv7(),
      generatedAt: at.toISOString(),
      windowDays: REPORT_WINDOW_DAYS,
      mostUsed,
      neverOpened: never,
      pendingProposals,
      markedStale,
      archived,
      mergeSuggestions,
      summary: lines.join(' '),
    });
    await db.insert(skillCuratorReports).values({ id: report.id, createdAt: at, report });
    // Catatan lama tidak berguna lagi; laporan dan skill tidak ikut terhapus.
    await db
      .delete(skillOpens)
      .where(lt(skillOpens.openedAt, new Date(at.getTime() - OPENS_RETENTION_DAYS * DAY_MS)));

    hub.publishLive('user', {
      type: 'notification',
      title: 'Laporan skill mingguan',
      body: report.summary,
      level: 'info',
      topic: 'skill_report',
    });
    log?.info(
      { stale: markedStale.length, archived: archived.length, merge: mergeSuggestions.length },
      'kurator skill selesai',
    );
    return report;
  }

  return {
    runOnce,
    async latest() {
      const [row] = await db
        .select()
        .from(skillCuratorReports)
        .orderBy(desc(skillCuratorReports.createdAt), desc(skillCuratorReports.id))
        .limit(1);
      if (!row) return null;
      const parsed = SkillCuratorReportSchema.safeParse(row.report);
      return parsed.success ? parsed.data : null;
    },
  };
}
