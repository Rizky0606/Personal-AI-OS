# Catatan kesiapan rilis — 2026-10-30

## Status

Belum siap dipublikasikan. Ini catatan persiapan lokal, bukan rilis atau hasil deploy. Versi metadata: desktop `1.0.3`; Android default `1.0.3`. Angka metadata bukan bukti tag rilis aktif.

Perubahan lokal sesi ini: penghapusan subtitle sambutan yang mengklaim role dipilih otomatis, checklist aksesibilitas baru, README diperbarui. Tidak ada kontrak API/event yang diubah.

## Bukti dan blocker

- `dsh`, `java`, `adb` tidak ditemukan di PATH. Android build/instrumentasi tidak dijalankan. `omp.exe` ditemukan; login→ringkasan E2E belum dijalankan.
- Percobaan ulang gagal sebelum test berjalan: port 1421 sudah dipakai. Tidak menghentikan proses yang belum diidentifikasi.
- `pnpm test` gagal: `@aios/roles` mengharapkan setiap skill tercatat di role/paket, tetapi menemukan `rich-answers` yatim (`packages/roles/src/roles.test.ts:79`). Skill lokal tidak diubah; perlu keputusan registrasi atau penghapusan terpisah.
- Adapter replay: 15 lulus, 2 skip. Hermes skip karena rekaman nyata tak tersedia; dsh integration skip karena tidak dikonfigurasi.
- `omp.exe` ditemukan di PATH; belum menjalankan login→ringkasan E2E aktual. `dsh`, `java`, `adb` tidak ditemukan.
- `pnpm typecheck` lulus: 12 task berhasil.
- `pnpm lint` gagal pada lima temuan lint/parsing di `RunActivity.tsx`, `useChatController.ts`, `RichAnswer.tsx`, `richAnswerParser.ts`; bukan perubahan sesi ini.
- `pnpm --filter @aios/desktop build` berhasil membuat frontend `apps/desktop/dist`; ada warning chunk `main` 860.19 kB, `styles` 516.30 kB. Ini bukan installer bertanda tangan.
- SHA-256 `apps/desktop/dist/index.html`: `b847fc2d2c71837bc1f45d866adab2598fc02ae5eaf05f8deab0c4d3faf3a927` (checksum satu file, bukan paket rilis).
- `pnpm --filter @aios/desktop exec vitest run src/designLint.test.ts`: 19/19 lulus.
- Desktop axe: terang lulus; gelap gagal `ENOENT` saat tutup trace. Port 1421 tetap sibuk; E2E penuh tak selesai.
- `pnpm test` gagal: `rich-answers` yatim pada registry role/skill. Adapter replay 91 lulus, 2 skip.
- Version metadata desktop/Android `1.0.3`. Android build tak tersedia tanpa Java/adb; signing desktop/Android belum ada. Tidak ada installer/APK atau checksum paket.

## Paket lokal

Sebelum menyatakan paket siap: jalankan `pnpm lint`, `pnpm typecheck`, `pnpm test`, E2E desktop penuh, dan build yang prasyaratnya tersedia. Simpan artefak di luar repo, hitung SHA-256, catat versi toolchain dan signing. Jangan jalankan `infra/scripts/release.mjs`, workflow publikasi, atau `infra/scripts/deploy.sh`.

## Deploy dan rollback (prosedur saja; belum dijalankan)

1. Tinjau ref/tag, migrasi, backup terbaru, readiness, ruang disk. Uji restore ke DB sementara; jangan gunakan DB produksi untuk tes.
2. Deploy gateway di VPS hanya lewat `infra/scripts/deploy.sh --ref vX.Y.Z`; skrip membackup, membangun image arm64, menjalankan migrasi, menunggu `/v1/readyz`, lalu mengembalikan image sebelumnya bila langkah gagal.
3. Rollback image tidak membatalkan migrasi database. Migrasi wajib kompatibel/aditif terhadap versi lama.
4. Bila data rusak, hentikan perubahan dan pulihkan snapshot melalui `infra/scripts/restore.sh` yang telah diuji. Verifikasi snapshot dan target database secara eksplisit; tindakan ini dapat mengubah data produksi.
5. Setelah deploy, periksa `/v1/readyz`, login, chat ringkas, redaksi log, worker, dan antrean. Tidak ada langkah deploy/rollback yang dilakukan sesi ini.
