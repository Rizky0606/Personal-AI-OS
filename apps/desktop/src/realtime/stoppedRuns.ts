const KEY = 'aios.stoppedRuns';
/** Cukup untuk run yang masih mungkin dibuka lagi; yang tertua dibuang. */
const LIMIT = 200;

function load(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

let stopped: string[] = load();

/**
 * Run yang dihentikan pemilik dari perangkat ini. Gateway tidak menandai run yang dihentikan tetapi sudah mengubah
 * berkas (statusnya `needs_review`, `error` null; lihat BACKLOG), jadi tanpa catatan ini jawabannya tampil "Selesai".
 * Dicatat setelah `POST /runs/:id/cancel` berhasil dan bertahan setelah muat ulang (localStorage).
 */
export function noteStopped(runId: string): void {
  if (stopped.includes(runId)) return;
  stopped = [...stopped, runId].slice(-LIMIT);
  try {
    localStorage.setItem(KEY, JSON.stringify(stopped));
  } catch {
    // Penyimpanan penuh atau dimatikan: tanda tetap berlaku selama sesi ini.
  }
}

export const wasStopped = (runId: string): boolean => stopped.includes(runId);
