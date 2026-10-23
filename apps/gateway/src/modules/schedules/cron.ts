import { CronExpressionParser } from 'cron-parser';

/** Cron tidak valid atau zona waktu tidak dikenal. Pesannya aman ditampilkan ke pengguna. */
export class CronError extends Error {
  constructor(
    readonly code: 'invalid_cron' | 'invalid_timezone',
    message: string,
  ) {
    super(message);
    this.name = 'CronError';
  }
}

export function assertTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    throw new CronError(
      'invalid_timezone',
      `Zona waktu "${timezone}" tidak dikenal (contoh: Asia/Jakarta).`,
    );
  }
}

/** Lima field cron (menit jam tanggal bulan hari-minggu). Melempar CronError bila tidak valid. */
export function normalizeCron(expression: string, timezone: string): string {
  assertTimezone(timezone);
  const cron = expression.trim().replace(/\s+/g, ' ');
  if (cron.split(' ').length !== 5) {
    throw new CronError(
      'invalid_cron',
      'Cron harus tepat 5 field: menit jam tanggal bulan hari-minggu.',
    );
  }
  try {
    CronExpressionParser.parse(cron, { tz: timezone });
  } catch {
    throw new CronError('invalid_cron', `Cron "${cron}" tidak valid.`);
  }
  return cron;
}

/** Waktu jalan berikutnya (ISO UTC) sesudah `from`, dihitung di zona waktu jadwal. */
export function nextRuns(cron: string, timezone: string, from: Date, count: number): Date[] {
  const iterator = CronExpressionParser.parse(cron, { tz: timezone, currentDate: from });
  return Array.from({ length: count }, () => iterator.next().toDate());
}

/**
 * Kemunculan jadwal di antara `after` (tidak termasuk) dan `until` (termasuk), paling banyak `limit` yang terbaru.
 * Dipakai mencatat jadwal yang terlewat saat server mati.
 */
export function occurrencesBetween(
  cron: string,
  timezone: string,
  after: Date,
  until: Date,
  limit: number,
): { total: number; latest: Date[] } {
  const iterator = CronExpressionParser.parse(cron, { tz: timezone, currentDate: after });
  const latest: Date[] = [];
  let total = 0;
  // Batas keras supaya cron per menit dan server mati berbulan-bulan tidak memutar tanpa akhir.
  for (let i = 0; i < 100_000; i++) {
    const next = iterator.next().toDate();
    if (next > until) break;
    total++;
    latest.push(next);
    if (latest.length > limit) latest.shift();
  }
  return { total, latest };
}

/* ---- Penjelasan yang dibaca manusia ---- */

const TZ_LABEL: Record<string, string> = {
  'Asia/Jakarta': 'WIB',
  'Asia/Pontianak': 'WIB',
  'Asia/Makassar': 'WITA',
  'Asia/Jayapura': 'WIT',
  UTC: 'UTC',
  'Etc/UTC': 'UTC',
};

export const tzLabel = (timezone: string): string => TZ_LABEL[timezone] ?? timezone;

const DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

const NUMBER = /^\d+$/;
const numbers = (field: string): number[] | undefined => {
  const parts = field.split(',');
  return parts.every((p) => NUMBER.test(p)) ? parts.map(Number) : undefined;
};
const pad = (n: number) => String(n).padStart(2, '0');
const joinList = (items: string[]) =>
  items.length <= 1
    ? (items[0] ?? '')
    : items.length === 2
      ? `${items[0]} dan ${items[1]}`
      : `${items.slice(0, -1).join(', ')}, dan ${items.at(-1)}`;

/** Hari (0–7) menjadi urutan Senin–Minggu, tanpa duplikat, lalu rentang berurutan ≥3 hari diringkas. */
function describeDays(field: string): string | undefined {
  const range = /^(\d)-(\d)$/.exec(field);
  const raw = range
    ? Array.from(
        { length: Number(range[2]) - Number(range[1]) + 1 },
        (_, i) => Number(range[1]) + i,
      )
    : numbers(field);
  if (!raw || raw.some((n) => n > 7)) return undefined;
  const days = [...new Set(raw.map((n) => (n === 0 ? 7 : n)))].sort((a, b) => a - b);
  const name = (n: number) => DAYS[n % 7] ?? '';
  const first = days[0];
  const last = days.at(-1);
  if (
    days.length >= 3 &&
    first !== undefined &&
    last !== undefined &&
    last - first === days.length - 1
  ) {
    return `${name(first)}–${name(last)}`;
  }
  return joinList(days.map(name));
}

/**
 * Penjelasan jadwal dalam bahasa Indonesia untuk bentuk cron yang umum ("Setiap Senin 07.00 WIB").
 * Bentuk lain jatuh ke ringkasan cron apa adanya, bukan tebakan.
 */
export function describeCron(cron: string, timezone: string): string {
  const zone = tzLabel(timezone);
  const [minute = '', hour = '', dom = '', month = '', dow = ''] = cron.split(' ');
  const fallback = `Cron "${cron}" (${zone})`;
  if (month !== '*') return fallback;

  const every = /^\*\/(\d+)$/;
  const stepMinute = every.exec(minute)?.[1];
  const stepHour = every.exec(hour)?.[1];

  if (hour === '*' && dom === '*' && dow === '*') {
    if (minute === '*') return 'Setiap menit';
    if (stepMinute) return Number(stepMinute) === 1 ? 'Setiap menit' : `Setiap ${stepMinute} menit`;
    if (minute === '0') return 'Setiap jam';
    if (NUMBER.test(minute)) return `Setiap jam pada menit ke-${Number(minute)}`;
    return fallback;
  }
  if (minute === '0' && stepHour && dom === '*' && dow === '*') {
    return Number(stepHour) === 1 ? 'Setiap jam' : `Setiap ${stepHour} jam`;
  }

  const minutes = numbers(minute);
  const hours = numbers(hour);
  const m = minutes?.[0];
  if (minutes?.length !== 1 || m === undefined || !hours) return fallback;
  const times = `${joinList(hours.map((h) => `${pad(h)}.${pad(m)}`))} ${zone}`;

  if (dom === '*' && dow === '*') return `Setiap hari ${times}`;
  if (dom === '*') {
    const days = describeDays(dow);
    return days ? `Setiap ${days} ${times}` : fallback;
  }
  const dates = numbers(dom);
  if (dates && dow === '*') {
    return `Setiap tanggal ${joinList(dates.map(String))} pukul ${times}`;
  }
  return fallback;
}
