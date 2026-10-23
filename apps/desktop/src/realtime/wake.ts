export interface WakeOptions {
  /** Selang pengecekan jam (ms). */
  intervalMs?: number;
  /** Lompatan jam yang dianggap "baru bangun dari tidur" (ms). */
  gapMs?: number;
}

/**
 * Mendeteksi PC bangun dari tidur atau jaringan kembali: tab terlihat lagi, event `online`, dan lompatan jam
 * (timer tidak berjalan saat tidur, jadi selisih waktu antar detak jauh melebihi selang). Mengembalikan fungsi berhenti.
 */
export function watchWake(
  onWake: (reason: 'visible' | 'online' | 'drift') => void,
  options: WakeOptions = {},
): () => void {
  const intervalMs = options.intervalMs ?? 5_000;
  const gapMs = options.gapMs ?? 15_000;
  let last = Date.now();

  const onVisibility = () => {
    if (document.visibilityState === 'visible') onWake('visible');
  };
  const onOnline = () => onWake('online');
  const timer = setInterval(() => {
    const now = Date.now();
    if (now - last > gapMs) onWake('drift');
    last = now;
  }, intervalMs);

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('online', onOnline);
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('online', onOnline);
  };
}
