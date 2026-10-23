const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function formatter(timeZone: string | undefined, options: Intl.DateTimeFormatOptions) {
  try {
    return new Intl.DateTimeFormat('id-ID', { ...options, ...(timeZone ? { timeZone } : {}) });
  } catch {
    // Zona waktu tak dikenal runtime: pakai zona perangkat.
    return new Intl.DateTimeFormat('id-ID', options);
  }
}

/** "22 Okt 2026 13.38" dalam zona waktu tertentu (default zona perangkat). */
export function formatDateTime(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return formatter(timeZone, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

/** "baru saja", "5 menit lalu", "3 jam lalu", atau tanggal untuk yang lebih dari sehari. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diff = now - then;
  if (diff < MINUTE) return 'baru saja';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} menit lalu`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} jam lalu`;
  return formatter(undefined, { dateStyle: 'medium' }).format(new Date(then));
}
