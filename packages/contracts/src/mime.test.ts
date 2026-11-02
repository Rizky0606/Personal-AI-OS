import { describe, expect, it } from 'vitest';
import { isRasterImageMime } from './mime.js';

describe('isRasterImageMime', () => {
  it('gambar raster dikenali, tanpa memandang huruf besar', () => {
    for (const mime of ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'IMAGE/PNG'])
      expect(isRasterImageMime(mime), mime).toBe(true);
  });

  it('SVG dan tipe lain bukan gambar: SVG bisa memuat skrip, jadi diperlakukan sebagai berkas', () => {
    for (const mime of [
      'image/svg+xml',
      'image/svg',
      'image/png-evil',
      'text/html',
      'application/pdf',
      '',
    ])
      expect(isRasterImageMime(mime), mime).toBe(false);
  });
});
