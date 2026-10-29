# Changelog

Format mengikuti [Keep a Changelog](https://keepachangelog.com/id-ID/1.1.0/); versi mengikuti [SemVer](https://semver.org/lang/id/).

## [Unreleased]

### Diubah

- **Perombakan tampilan "Command Center"** (desktop dan Android): satu sidebar 232 px dengan pencarian Ctrl K, enam bagian, daftar konteks, serta kartu status worker/kuota (menggantikan rail dan status bar); header 48 px dengan breadcrumb project/branch dan pil status run; jawaban AI tanpa kartu, langkah tool sebagai chip, composer mengambang, dan **Agent HUD** satu bilah lipat untuk rencana, antrean, dan subagent; tab panel kanan berbentuk pil dengan ikon; layar Project, Pengaturan, Kanban, dan lainnya diselaraskan dengan header halaman dan dialog seragam; radius baru (desktop 6/10/14, Android 10/14/20). Android: kartu jawaban tanpa bingkai tebal, composer membulat, baris daftar lebih lega, pengaturan berkelompok. Fitur dan pintasan tidak berubah.

### Ditambah

- Desktop: arahkan agent coding yang sedang berjalan dari composer. Enter menyisipkan arahan setelah langkah yang sedang berjalan, Alt+Enter mengantre pesan sampai agent selesai (`POST /runs/:id/steer` menerima `mode: steer | followUp`).
- Desktop, layar Project: **Setup worktree** per project (disimpan di worker): perintah yang dijalankan sebelum agent mulai (mis. `pnpm install --offline`, tampil sebagai langkah `setup` di chat) dan opsi menautkan node_modules.
- LSP omp untuk run coding: agent mendapat diagnostik tipe setelah mengubah berkas serta definisi dan referensi, bila server bahasa ditemukan di worktree atau PATH. Bisa dimatikan per project.
- Rencana agent langsung: daftar tugas dari tool `todo` omp tampil di jawaban yang sedang berjalan, dengan bilah kemajuan dan status tiap tugas (event baru `todo.updated`).
- Antrean arahan terlihat: arahan (Enter) dan pesan antre (Alt+Enter) yang belum diproses agent tampil sebagai daftar "Menunggu giliran" dan hilang saat diproses (event baru `queue.updated`).
- Agent bisa bertanya langsung ke pengguna: tool `ask` omp tampil sebagai panel "Agent bertanya" (pilihan tunggal atau ganda, teks bebas, atau "Pakai yang disarankan"). Adapter omp kini berjalan di `--mode rpc-ui` karena di `--mode rpc` tool `ask` tidak tersedia; izin tool tetap lewat panel izin (diuji).
- Arahan yang masih mengantre bisa ditarik: tombol X di daftar "Menunggu giliran" (`POST /runs/:id/queue/remove`, omp `remove_queued_message`; diuji dengan omp sungguhan).
- Subagent omp (tool `task`) tampil sebagai pohon di tab Aktivitas: nama, jenis agent, status, tugas, jumlah tool, durasi, dan keluaran terakhir (event baru `subagent.updated`).
- Skill `find-skills` (adaptasi vercel-labs/skills) untuk agent umum dan project: bila topik spesifik dan belum ditutup skill yang dimuat, agent mencari skill yang cocok di skills.sh dan merekomendasikannya (nama, pemasang, perintah pasang). Hanya mencari; pemasangan tetap oleh pemilik.

## [1.0.3] - 2026-10-25

### Diubah

- Palet baru **Electric Slate** (navy slate, aksen cyan elektrik, teal, dan emerald) di desktop dan Android, tema gelap dan terang; kontras teks tetap WCAG AA.
- Jawaban AI tampil dalam kartu dengan avatar bot dan titik status, nama, chip role berbentuk pil, dan model; gelembung pengguna menampilkan jam kirim dan tanda terkirim; logo di rail desktop.
- Sudut lebih bulat (kartu 16 px, kontrol 8 px) dan ikon aplikasi navy-cyan.
- Action GitHub diperbarui ke versi Node 24; runner dikunci ke Ubuntu 24.04.
- Backup: dump database tanpa kompresi internal (restic dedup + zstd max) dan retensi 31 hari.

## [1.0.2] - 2026-10-24

### Diubah

- Tampilan lebih hidup tapi tetap rapi (desktop dan Android): layar sambutan di chat kosong dengan cahaya aksen dan kartu saran yang muncul bertahap; tombol utama bergradien oranye dan bercahaya; pesan muncul dengan pegas ringan; indikator sedang menulis bercahaya; item aktif dengan sapuan aksen; kartu kanban terangkat saat hover.
- Chat project menampilkan saran pekerjaan coding (struktur project, perbaiki bug, tambah fitur, tulis tes).
- Design system: token gerak baru (emphasis 320 ms, kurva pegas ringan); gradien satu warna aksen dan cahaya aksen kini diizinkan di titik-titik penting.

## [1.0.1] - 2026-10-24

Rilis stabil pertama yang diterbitkan lewat tag (build `1.0.0` sebelumnya hanya artefak CI dari `main`). Mulai rilis ini versi naik di setiap tag, sehingga installer Windows dan APK Android terpasang menimpa versi sebelumnya, dan aplikasi Windows memperbarui diri lewat bagian Pembaruan di Pengaturan.

### Ditambahkan

- **Chat** umum dan chat project dengan streaming, pemilihan role dan model, router otomatis, penjadwalan, dan riset bersitasi (desktop dan Android).
- **Run coding** lewat worker lokal dan omp: worktree per run, izin (approval) inline, diff dengan komentar, terima/tolak, commit Conventional pada branch `aios/<id>`.
- **Kanban AI**: kartu dikerjakan AI dengan batas run paralel dan antrean; pecah ide menjadi kartu.
- **Preview dan pengujian**: preview dev server di panel kanan, console, pilih elemen ke composer, tool browser (Playwright) untuk agent.
- **Terminal** PTY, palet perintah (Ctrl+K), status bar lengkap, pembanding model, halaman Kuota dan Status.
- **Keamanan**: audit otomatis (`docs/SECURITY_AUDIT.md`), backup dan restore terenkripsi (restic), Uptime Kuma, pemeriksaan versi tool.
- **Pengemasan**: installer Windows NSIS dengan sidecar worker; auto-update Tauri dari rilis GitHub (bagian Pembaruan di Pengaturan); APK Android release bertanda tangan lewat CI.
- **Deploy**: `infra/scripts/deploy.sh` (build arm64, migrasi, restart, cek `/v1/readyz`, rollback image bila gagal).
- **Lampiran chat**: gambar (dikirim ke model vision), PDF, DOCX, dan berkas teks (diambil teksnya) dari desktop (pilih, seret, tempel) dan Android (pemilih dokumen).
- **Ubah dan hapus pesan** di mana pun dalam percakapan; agent memulai sesi baru dengan riwayat yang tersisa sehingga bagian yang dibuang tidak diingat.
- **Rilis bertag**: `infra/scripts/release.mjs` menaikkan versi dan membuat tag; versionCode Android naik di setiap build CI.
- **Uji E2E** desktop (Playwright, stack nyata: gateway, worker, omp) dan Android (Compose UI test melawan gateway nyata), plus audit aksesibilitas axe dan lint desain statis.

### Diubah

- Token warna `text-3` dan `accent` (terang) disesuaikan agar lolos kontras WCAG AA; `docs/DESIGN_SYSTEM.md` diperbarui.
- Animasi skeleton memakai kurva token; `prefers-reduced-motion` tidak lagi menyebabkan animasi berkedip.
- Gerak dan polish antarmuka (pesan muncul halus, indikator sedang menulis, penanda aktif, menu dan dialog beranimasi) di desktop dan Android.
- Alamat gateway tertanam saat build; layar login hanya meminta password dan TOTP.
- Role ditentukan router (pemilih role di composer dihapus); role Umum boleh menulis kode di chat; chat project mengutamakan role coding.

### Diperbaiki

- Worker sidecar `.exe` tidak lagi mati saat start (playwright-core dimuat malas), sehingga status worker tersambung.
- Riset tidak lagi gagal di tahap menulis laporan karena batas waktu; galat model dipetakan ke pesan yang jelas.
- Urutan pesan chat desktop tidak lagi terbalik.

### Diketahui

- Kartu Kanban yang butuh izin belum punya UI izin sendiri; izin dijawab dari percakapan kartu (lihat `docs/BACKLOG.md`).
- Aplikasi Windows yang terpasang dari build `main` sebelum rilis ini belum membawa kunci updater: pasang installer rilis ini sekali secara manual, setelah itu pembaruan berjalan dari aplikasi.
