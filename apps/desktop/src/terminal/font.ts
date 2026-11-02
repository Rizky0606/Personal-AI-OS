/** Ukuran font terminal (px); dipakai juga untuk memuat font sebelum xterm mengukur sel. */
export const TERMINAL_FONT_SIZE = 13;

const FALLBACK = "'Geist Mono', 'IBM Plex Mono', monospace";

/** Keluarga font terminal dari token `--font-mono` (Geist Mono), dengan cadangan tetap bila token tidak terbaca. */
export function terminalFontFamily(): string {
  const token = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim();
  return token || FALLBACK;
}

/**
 * Menunggu Geist Mono termuat (`document.fonts.load` lalu `document.fonts.ready`). xterm mengukur lebar sel saat
 * `open()`; bila font belum ada, sel diukur dengan font cadangan dan teks terminal bergeser setelah font datang.
 * Tanpa API font (jsdom) atau bila gagal, langsung lanjut: terminal tetap bisa dipakai dengan font cadangan.
 */
export async function terminalFontReady(): Promise<void> {
  const fonts = (document as { fonts?: FontFaceSet }).fonts;
  if (!fonts) return;
  try {
    await fonts.load(`${TERMINAL_FONT_SIZE}px "Geist Mono"`);
    await fonts.ready;
  } catch {
    /* font gagal dimuat: pakai cadangan */
  }
}
