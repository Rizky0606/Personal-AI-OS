import { isTauri } from './tauri';

/** Dialog pilih folder bawaan sistem. null bila dibatalkan, atau di luar aplikasi Tauri (peramban dev). */
export async function pickFolder(title: string): Promise<string | null> {
  if (!isTauri()) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const selected = await open({ directory: true, multiple: false, title });
  return typeof selected === 'string' ? selected : null;
}
