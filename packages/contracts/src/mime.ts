/**
 * Gambar raster yang ditampilkan sebagai gambar (thumbnail dan lightbox). SVG sengaja tidak termasuk: berkas SVG bisa
 * memuat skrip, jadi diperlakukan sebagai berkas biasa (unduh), bukan gambar yang dirender di aplikasi.
 */
export const isRasterImageMime = (mime: string): boolean =>
  /^image\/(png|jpeg|webp|gif)$/i.test(mime);
