# Checklist aksesibilitas — kesiapan rilis

Automasi tersedia: axe Playwright (`e2e/tests/a11y.spec.ts`) untuk login dan 11 layar desktop, tema terang/gelap; tes unit/instrumentasi dan screenshot Compose Android; `designLint.test.ts`. Sesi ini: tema terang lulus; tema gelap berakhir `ENOENT` saat menutup context trace, tanpa error axe yang tercatat di error-context. Screenshot lama bukan bukti audit manual.

## Sebelum rilis

- [ ] Desktop: keyboard saja; urutan fokus, ring terlihat, dialog/palet mengunci dan mengembalikan fokus.
- [ ] Desktop: pembaca layar mengumumkan label, status koneksi, progres streaming, error, dan perubahan konten.
- [ ] Android: TalkBack membaca label kontrol, tujuan navigasi, status/progres, serta urutan fokus.
- [ ] Android: ukuran teks sistem 200%; tidak ada teks/kontrol terpotong atau aksi tak terjangkau.
- [ ] Kedua klien: gerak sistem dikurangi; tidak ada animasi dekoratif yang tetap berjalan.
- [ ] Kedua klien: kontras teks ≥ 4.5:1, elemen UI ≥ 3:1; uji tema terang/gelap.
- [ ] Kedua klien: target sentuh/fokus, orientasi, zoom, dan state kosong/error/offline.

Status sesi: belum ada verifikasi manual baru; jangan tandai item selesai dari screenshot atau tes komponen saja.
