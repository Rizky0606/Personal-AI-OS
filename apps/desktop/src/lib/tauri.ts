/** Berjalan di dalam cangkang Tauri (bukan peramban biasa saat `vite dev`)? */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Label jendela Tauri tempat kode ini berjalan (mis. `main`, `quick`), atau null di luar Tauri dan di E2E (shim
 * tidak membawa metadata jendela).
 */
export function currentWindowLabel(): string | null {
  if (typeof window === 'undefined') return null;
  const internals = (
    window as { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } } }
  ).__TAURI_INTERNALS__;
  return internals?.metadata?.currentWindow?.label ?? null;
}
