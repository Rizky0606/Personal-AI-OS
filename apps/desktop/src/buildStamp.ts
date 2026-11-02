/** Konstanta yang hanya ditanam oleh e2e/vite.e2e.config.ts; di build rilis tidak terdefinisi. */
declare const __BUILD_COMMIT__: string | undefined;
declare const __BUILD_TIME__: string | undefined;
declare const __BUILD_DIRTY__: boolean | undefined;

export interface BuildStamp {
  commit: string;
  time: string;
  dirty: boolean;
}

/** Cap build e2e, atau null di build rilis. */
export function readBuildStamp(): BuildStamp | null {
  if (typeof __BUILD_COMMIT__ === 'undefined' || !__BUILD_COMMIT__) return null;
  return {
    commit: __BUILD_COMMIT__,
    time: typeof __BUILD_TIME__ === 'undefined' ? '' : __BUILD_TIME__,
    dirty: typeof __BUILD_DIRTY__ === 'undefined' ? false : __BUILD_DIRTY__,
  };
}

/**
 * Menandai build e2e agar screenshot bisa dibuktikan berasal dari commit tertentu: atribut
 * `data-build-commit` di elemen root dan label kecil di pojok kanan bawah. Tidak berbuat apa-apa di build rilis.
 */
export function installBuildStamp(root: HTMLElement, stamp: BuildStamp | null = readBuildStamp()) {
  if (!stamp) return;
  root.setAttribute('data-build-commit', stamp.commit);
  root.setAttribute('data-build-dirty', String(stamp.dirty));
  const label = document.createElement('div');
  label.setAttribute('data-build-label', '');
  label.setAttribute('aria-hidden', 'true');
  label.className =
    'pointer-events-none fixed bottom-1 right-2 z-50 font-mono text-caption text-text-3';
  label.textContent = `${stamp.commit}${stamp.dirty ? '*' : ''} ${stamp.time}`.trim();
  document.body.appendChild(label);
}
