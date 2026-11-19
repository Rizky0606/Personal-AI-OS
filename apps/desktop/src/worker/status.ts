import type { ProjectWorkerStatusSchema } from '@aios/contracts';
import type { z } from 'zod';
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

export type ProjectWorkerIndicator = 'connected' | 'offline' | 'revoked' | 'other';

/**
 * Keadaan worker project aktif menurut gateway. "Dicabut" dan "worker lain" berarti run project ini tidak akan
 * sampai ke worker PC ini sampai project diikat ulang; `ownDeviceId` null = worker PC ini belum terdaftar, jadi
 * project tidak bisa dibandingkan dan hanya status online yang dipakai.
 */
export function projectWorkerIndicator(
  status: z.infer<typeof ProjectWorkerStatusSchema>,
  ownDeviceId: string | null,
): ProjectWorkerIndicator {
  if (status.revoked) return 'revoked';
  if (ownDeviceId !== null && status.workerDeviceId !== ownDeviceId) return 'other';
  return status.online ? 'connected' : 'offline';
}
