import { and, desc, eq, gte, ne } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import {
  messages,
  projects,
  researchJobs,
  scheduleRuns,
  schedules,
  tasks,
} from '../../db/schema/index.js';
import { tzLabel } from './cron.js';

/*
 * Konteks tambahan untuk jadwal: data briefing pagi (W18) dan hasil run sebelumnya untuk jadwal `on_change` (W19).
 * Konteks dikirim ke agent bersama prompt jadwal tetapi tidak disimpan sebagai pesan pengguna.
 */

/** Awalan yang diminta dari agent bila hasil run jadwal `on_change` sama dengan sebelumnya. */
export const NO_CHANGE_MARKER = '[TIDAK ADA PERUBAHAN]';

const BRIEFING_WINDOW_MS = 24 * 60 * 60_000;
const MAX_ITEMS = 10;
const MAX_PREVIOUS_CHARS = 4000;

const when = (date: Date, timezone: string) =>
  `${new Intl.DateTimeFormat('id-ID', {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date)} ${tzLabel(timezone)}`;

const list = (items: string[]) => (items.length ? items.map((i) => `- ${i}`) : ['- (tidak ada)']);

const oneLine = (text: string, max = 160) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

const RUN_STATUS: Record<string, string> = {
  succeeded: 'berhasil',
  failed: 'gagal',
  missed: 'terlewat',
  running: 'masih berjalan',
};

/** Ringkasan aktivitas 24 jam terakhir dan instruksi menyusun briefing. */
export async function briefingContext(
  db: Database,
  opts: { now: Date; timezone: string; scheduleId: string },
): Promise<string> {
  const since = new Date(opts.now.getTime() - BRIEFING_WINDOW_MS);

  const research = await db
    .select({ question: researchJobs.question })
    .from(researchJobs)
    .where(and(eq(researchJobs.status, 'completed'), gte(researchJobs.updatedAt, since)))
    .orderBy(desc(researchJobs.updatedAt))
    .limit(MAX_ITEMS);

  const review = await db
    .select({ title: tasks.title, project: projects.name })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(eq(tasks.status, 'review'))
    .orderBy(desc(tasks.updatedAt))
    .limit(MAX_ITEMS);

  const done = await db
    .select({ title: tasks.title, project: projects.name })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(eq(tasks.status, 'done'), gte(tasks.updatedAt, since)))
    .orderBy(desc(tasks.updatedAt))
    .limit(MAX_ITEMS);

  const runsOfOthers = await db
    .select({ name: schedules.name, status: scheduleRuns.status, changed: scheduleRuns.changed })
    .from(scheduleRuns)
    .innerJoin(schedules, eq(schedules.id, scheduleRuns.scheduleId))
    .where(and(gte(scheduleRuns.startedAt, since), ne(scheduleRuns.scheduleId, opts.scheduleId)))
    .orderBy(desc(scheduleRuns.startedAt))
    .limit(MAX_ITEMS);

  return [
    `# Data briefing (24 jam terakhir, sampai ${when(opts.now, opts.timezone)})`,
    '',
    '## Riset yang selesai',
    ...list(research.map((r) => oneLine(r.question))),
    '',
    '## Kartu kanban menunggu review',
    ...list(review.map((t) => `[${t.project}] ${oneLine(t.title)}`)),
    '',
    '## Kartu kanban yang selesai',
    ...list(done.map((t) => `[${t.project}] ${oneLine(t.title)}`)),
    '',
    '## Hasil jadwal lain',
    ...list(
      runsOfOthers.map(
        (r) =>
          `${oneLine(r.name, 80)}: ${r.changed === false ? 'tidak berubah' : (RUN_STATUS[r.status] ?? r.status)}`,
      ),
    ),
    '',
    'Susun briefing pagi untuk pemilik dalam bahasa Indonesia, ringkas (sekitar 250 kata): mulai dengan yang perlu ditindaklanjuti (kartu menunggu review, jadwal gagal), lalu ringkasan aktivitas, lalu topik pilihan dari pesan di atas bila ada (cari info terbaru dan sebut sumbernya). Lewati bagian yang kosong; jangan mengarang data yang tidak ada di atas.',
  ].join('\n');
}

/** Teks jawaban terakhir di percakapan jadwal, atau null bila belum pernah ada (run pertama selalu memberi tahu). */
export async function previousResult(
  db: Database,
  conversationId: string,
): Promise<{ text: string; at: Date } | null> {
  const rows = await db
    .select({ parts: messages.parts, createdAt: messages.createdAt })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.author, 'assistant')))
    .orderBy(desc(messages.id))
    .limit(5);
  for (const row of rows) {
    const text = row.parts
      .map((p) => (p.type === 'text' ? p.text : ''))
      .join('\n')
      .trim();
    if (text) return { text, at: row.createdAt };
  }
  return null;
}

/** Konteks pembanding untuk jadwal `on_change`. */
export function changeContext(previous: { text: string; at: Date }, timezone: string): string {
  const text =
    previous.text.length > MAX_PREVIOUS_CHARS
      ? `${previous.text.slice(0, MAX_PREVIOUS_CHARS)}…`
      : previous.text;
  return [
    `# Hasil run sebelumnya (${when(previous.at, timezone)})`,
    '<<<',
    text,
    '>>>',
    `Bandingkan hasil baru dengan hasil sebelumnya. Bila tidak ada perubahan yang berarti bagi pemilik, awali jawaban persis dengan ${NO_CHANGE_MARKER} lalu satu kalimat singkat. Bila ada perubahan, sebutkan dulu apa yang berubah, lalu hasil lengkapnya.`,
  ].join('\n');
}

/** Hasil `on_change`: apakah agent menyatakan sama, dan teks yang ditampilkan (penanda diganti kalimat biasa). */
export function readChange(text: string): { changed: boolean; display: string } {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith(NO_CHANGE_MARKER)) return { changed: true, display: text };
  const rest = trimmed.slice(NO_CHANGE_MARKER.length).trim();
  return {
    changed: false,
    display: `**Tidak ada perubahan sejak run sebelumnya.**${rest ? ` ${rest}` : ''}`,
  };
}
