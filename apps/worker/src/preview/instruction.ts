/**
 * Ditambahkan ke prompt sistem run coding bila tool browser tersedia. Menyebut tool dan kebiasaan yang
 * dipakai untuk memperbaiki tampilan: lihat dulu, ubah, lalu verifikasi dengan screenshot kedua.
 */
export const BROWSER_INSTRUCTION =
  '\n\nKamu punya tool browser untuk melihat hasil kerjamu di halaman preview project: ' +
  'browser_screenshot (width/height untuk ukuran layar, selector untuk satu elemen, reload=true setelah mengubah kode), ' +
  'browser_click, browser_fill, dan browser_console (error console dan request gagal). Dev server dijalankan otomatis. ' +
  'Untuk perbaikan tampilan: ambil screenshot sebelum mengubah, ubah kodenya, lalu ambil screenshot lagi ' +
  '(reload=true) dan pastikan masalahnya benar-benar hilang sebelum menyatakan selesai. ' +
  'Untuk tampilan ponsel pakai width 390; tablet 768.';
