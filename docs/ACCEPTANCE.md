# Checklist Acceptance & Risiko — Personal AI OS

Sebuah tahap dianggap selesai hanya bila semua kotaknya tercentang. Checklist ini juga menjadi acuan Fase 24.

## Tahap A — Fondasi

- [ ] VERIFICATION.md menjawab cara streaming Hermes, format RPC omp, dan cara menyuntik role ke keduanya
- [ ] CI hijau di repo kosong
- [ ] Token desain ter-generate ke CSS dan Kotlin dari satu file
- [ ] /readyz di VPS melaporkan Postgres, Hermes, 9Router, SearXNG
- [ ] Login dengan TOTP berhasil; token lama yang dipakai ulang mencabut perangkat
- [ ] Panggilan model lewat /llm/v1 berhasil; tidak ada API key di klien

## Tahap B — Inti server

- [ ] Chat streaming tidak kehilangan event setelah koneksi diputus
- [ ] 7 role valid dan bundel tiap role di bawah anggaran token
- [ ] `pnpm eval:routing` minimal 90%
- [ ] Laporan riset punya rujukan di setiap paragraf faktual
- [ ] Jadwal berjalan tepat waktu dan tidak dobel; notifikasi uji sampai ke HP

## Tahap C — Android

- [ ] Login satu layar, masuk otomatis setelahnya
- [ ] Chat, riset, jadwal berjalan dengan data yang sama seperti desktop
- [ ] Notifikasi membuka layar yang tepat; share intent dan input suara berfungsi
- [ ] Tema terang dan gelap lolos checklist design system

## Tahap D dan E — Windows

- [ ] Login sekali, tersambung kembali sendiri setelah PC tidur atau idle lama
- [ ] Worker menolak path di luar folder yang diizinkan, termasuk symlink
- [ ] Run coding tidak pernah mengubah branch kerja sebelum diterima
- [ ] Setiap perintah non-baca meminta izin kecuali ada aturan "selalu"
- [ ] Komentar diff per baris diperbaiki agent dengan tepat
- [ ] Dua kartu kanban berjalan paralel tanpa konflik
- [ ] Agent bisa mengambil screenshot preview dan membaca error console
- [ ] Alur utama bisa dipakai penuh dengan keyboard

## Tahap F — Rilis

- [ ] Restore backup uji berhasil
- [ ] Audit keamanan tanpa temuan tinggi
- [ ] E2E desktop dan Android lulus
- [ ] Installer Windows dan APK bertanda tangan terpasang bersih di perangkat baru

## Risiko dan mitigasi

| Risiko | Dampak | Mitigasi |
| --- | --- | --- |
| Protokol omp atau Hermes berubah saat update | Adapter rusak | Versi dikunci, tes adapter dengan transkrip nyata, upgrade satu per satu |
| omp tidak bisa menerima role tanpa menulis file | Worktree kotor | Fallback pesan sistem pertama; verifikasi di Fase 0 |
| Router salah pilih role | Jawaban melenceng | Chip koreksi, koreksi masuk prompt router, eval 90% |
| RAM VPS 12 GB penuh saat riset mendalam + banyak run | Layanan lambat | Batas paralelisme job, Chromium hanya saat perlu, swap, tes beban di Fase 23 |
| Kuota provider habis | Run gagal | Combo fallback di 9Router, dasbor kuota, error yang jelas |
| Agent menjalankan perintah berbahaya | Kerusakan data PC | Worktree, daftar folder, approval wajib, batas waktu run |
| Fitur melebar ke mana-mana | Proyek tidak selesai | Satu fase per sesi, BACKLOG.md untuk ide di luar scope |
| Pemakaian MITM atau pooling langganan di 9Router | Melanggar ToS provider | Gunakan API key resmi untuk combo gateway |

## Hal yang belum terverifikasi

- Detail streaming, sesi, dan skill pada API server Hermes.
- Format pasti event RPC omp, termasuk event approval, dan cara menyuntik system prompt.
- Apakah 9Router menyediakan endpoint kuota atau usage yang bisa dibaca gateway.
- Ketersediaan endpoint STT di 9Router untuk input suara Android.

Semua poin di atas dijawab oleh Fase 0. Jika jawabannya berbeda dari asumsi dokumen ini, perbarui dokumen dulu sebelum lanjut ke Fase 1.
