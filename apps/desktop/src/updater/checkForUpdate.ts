import { isTauri } from '../lib/tauri';

export type UpdateCheck =
  | { kind: 'unavailable' }
  | { kind: 'current' }
  | { kind: 'available'; version: string; install: () => Promise<void> };

/**
 * Memeriksa rilis baru lewat plugin updater Tauri (rilis GitHub privat, tanda tangan diverifikasi oleh plugin
 * dengan kunci publik di tauri.conf.json). Di luar cangkang Tauri tidak ada yang bisa diperiksa.
 * Pemasangan NSIS menutup aplikasi sendiri; tidak ada token atau rahasia yang melewati kode ini.
 */
export async function checkForUpdate(): Promise<UpdateCheck> {
  if (!isTauri()) return { kind: 'unavailable' };
  const { check } = await import('@tauri-apps/plugin-updater');
  const update = await check();
  if (!update) return { kind: 'current' };
  return {
    kind: 'available',
    version: update.version,
    install: () => update.downloadAndInstall(),
  };
}
