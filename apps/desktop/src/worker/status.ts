import type { WorkerSnapshot } from './localClient';

export type WorkerIndicator = 'connected' | 'reconnecting' | 'off';

/**
 * Tiga keadaan untuk status bar. "Menyambung ulang" mencakup worker lokal yang belum siap, gateway yang sedang
 * disambung, dan jeda singkat saat sesi worker baru didaftarkan; "mati" bila worker lokal tidak ada atau
 * gateway tidak lagi dipakai (mis. digantikan koneksi lain).
 */
export function workerIndicator(snapshot: WorkerSnapshot): WorkerIndicator {
  if (snapshot.local === 'off') return 'off';
  if (snapshot.local !== 'connected' || snapshot.status === null) return 'reconnecting';
  switch (snapshot.status.gateway) {
    case 'connected':
      return 'connected';
    case 'connecting':
    case 'reconnecting':
      return 'reconnecting';
    case 'offline':
      return snapshot.status.deviceId === null ? 'reconnecting' : 'off';
  }
}
