/* global window, document, getComputedStyle, Image, ImageData */
/**
 * Fungsi yang dijalankan DI DALAM halaman (page.evaluate / addInitScript) oleh shots.ts dan shots-compare.ts.
 * Ditulis sebagai JavaScript karena memakai API DOM, sedangkan tsconfig harness sengaja tanpa lib DOM (bentrok
 * dengan tipe Node di kode gateway yang diimpor harness). Tipenya ada di in-page.d.ts. Setiap fungsi harus
 * berdiri sendiri: tidak boleh memakai impor atau variabel luar karena diserialisasi ke halaman.
 */

export function installE2eGlobals({ controlUrl, pick }) {
  Object.assign(window, {
    __TAURI_INTERNALS__: {},
    __E2E_CONTROL__: controlUrl,
    __E2E_PICK_FOLDER__: pick,
    __E2E_PICK_FOLDER: pick,
  });
}

/** Menggulir area isi (bukan sidebar): elemen di dalam <main> dengan isi terpanjang yang bisa digulir. */
export function scrollMainContent() {
  const main = document.querySelector('main');
  if (!main) return;
  const candidates = [main, ...main.querySelectorAll('*')].filter(
    (el) =>
      el.scrollHeight > el.clientHeight + 8 &&
      ['auto', 'scroll'].includes(getComputedStyle(el).overflowY),
  );
  const target = candidates.sort((x, y) => y.scrollHeight - x.scrollHeight)[0];
  if (target) target.scrollTop = target.scrollHeight;
}

export async function comparePixels({ imgA, imgB, threshold, mask }) {
  const load = (b64) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('gambar tidak terbaca'));
      img.src = `data:image/png;base64,${b64}`;
    });
  const [ia, ib] = await Promise.all([load(imgA), load(imgB)]);
  if (ia.width !== ib.width || ia.height !== ib.height)
    return { sizeMismatch: `${ia.width}x${ia.height} vs ${ib.width}x${ib.height}` };
  const { width: w, height: h } = ia;
  const pixels = (img) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, w, h).data;
  };
  const pa = pixels(ia);
  const pb = pixels(ib);
  const diff = new ImageData(w, h);
  let changed = 0;
  let counted = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const masked = x >= w - mask.width && y >= h - mask.height;
      const differs =
        !masked &&
        (Math.abs(pa[i] - pb[i]) > threshold ||
          Math.abs(pa[i + 1] - pb[i + 1]) > threshold ||
          Math.abs(pa[i + 2] - pb[i + 2]) > threshold);
      if (!masked) counted++;
      if (differs) changed++;
      diff.data.set(differs ? [255, 0, 80, 255] : [pa[i], pa[i + 1], pa[i + 2], 70], i);
    }
  }
  const out = document.createElement('canvas');
  out.width = w * 3;
  out.height = h;
  const octx = out.getContext('2d');
  octx.drawImage(ia, 0, 0);
  octx.drawImage(ib, w, 0);
  octx.putImageData(diff, w * 2, 0);
  return { percent: (changed / counted) * 100, side: out.toDataURL('image/png').split(',')[1] };
}

/** Chip Progres di topbar sedang menampilkan label yang diawali `prefix` (mis. "Langkah 7 dari 9")? */
export function chipStartsWith(prefix) {
  const label = document
    .querySelector('button[aria-keyshortcuts="Control+."]')
    ?.getAttribute('aria-label');
  return typeof label === 'string' && label.startsWith(prefix);
}
