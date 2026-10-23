/** Berjalan di dalam cangkang Tauri (bukan peramban biasa saat `vite dev`)? */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}
