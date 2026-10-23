/**
 * Pemeriksaan tata letak di dalam halaman (string agar tidak butuh tipe DOM di worker). Model tanpa kemampuan
 * melihat gambar tetap bisa memverifikasi perbaikan dari laporan ini: elemen yang keluar dari viewport,
 * gulir mendatar, dan teks yang terpotong.
 */
export const LAYOUT_SCRIPT = `(() => {
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const describe = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    else if (el.classList.length) s += '.' + Array.from(el.classList).slice(0, 2).join('.');
    return s;
  };
  const outside = [];
  const clipped = [];
  for (const el of document.body ? document.body.querySelectorAll('*') : []) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') continue;
    if (rect.right > vw + 1 || rect.left < -1) {
      outside.push(describe(el) + ' (kiri ' + Math.round(rect.left) + ', kanan ' + Math.round(rect.right) + ', lebar ' + Math.round(rect.width) + ')');
    }
    if (el.scrollWidth > el.clientWidth + 1 && /hidden|clip/.test(style.overflowX) && el.clientWidth > 0) {
      clipped.push(describe(el) + ' (isi ' + el.scrollWidth + ' px dalam ' + el.clientWidth + ' px)');
    }
  }
  return {
    viewport: { width: vw, height: vh },
    horizontalScroll: document.documentElement.scrollWidth > vw + 1,
    scrollWidth: document.documentElement.scrollWidth,
    outside: outside.slice(0, 10),
    clipped: clipped.slice(0, 10),
  };
})()`;

export interface LayoutReport {
  viewport: { width: number; height: number };
  horizontalScroll: boolean;
  scrollWidth: number;
  outside: string[];
  clipped: string[];
}

/** Ringkasan teks untuk agent. */
export function describeLayout(report: LayoutReport): string {
  const lines: string[] = [];
  if (report.horizontalScroll) {
    lines.push(
      `Halaman bisa digulir mendatar: lebar isi ${report.scrollWidth} px, viewport ${report.viewport.width} px.`,
    );
  }
  if (report.outside.length > 0) {
    lines.push(`Elemen melewati batas viewport: ${report.outside.join('; ')}.`);
  }
  if (report.clipped.length > 0)
    lines.push(`Isi terpotong (overflow): ${report.clipped.join('; ')}.`);
  return lines.length > 0
    ? `Tata letak bermasalah. ${lines.join(' ')}`
    : 'Tata letak: tidak ada elemen yang melewati batas viewport dan tidak ada gulir mendatar.';
}
