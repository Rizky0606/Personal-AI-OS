# Changelog

Format mengikuti [Keep a Changelog](https://keepachangelog.com/id-ID/1.1.0/); versi mengikuti [SemVer](https://semver.org/lang/id/).

## [1.0.0] - belum dirilis

Rilis stabil pertama. Tag `v1.0.0` baru dibuat setelah daftar di `docs/ACCEPTANCE.md` diverifikasi di VPS dan perangkat nyata.

### Ditambahkan

- **Chat** umum dan chat project dengan streaming, pemilihan role dan model, router otomatis, penjadwalan, dan riset bersitasi (desktop dan Android).
- **Run coding** lewat worker lokal dan omp: worktree per run, izin (approval) inline, diff dengan komentar, terima/tolak, commit Conventional pada branch `aios/<id>`.
- **Kanban AI**: kartu dikerjakan AI dengan batas run paralel dan antrean; pecah ide menjadi kartu.
- **Preview dan pengujian**: preview dev server di panel kanan, console, pilih elemen ke composer, tool browser (Playwright) untuk agent.
- **Terminal** PTY, palet perintah (Ctrl+K), status bar lengkap, pembanding model, halaman Kuota dan Status.
- **Keamanan**: audit otomatis (`docs/SECURITY_AUDIT.md`), backup dan restore terenkripsi (restic), Uptime Kuma, pemeriksaan versi tool.
- **Pengemasan**: installer Windows NSIS dengan sidecar worker; auto-update Tauri dari rilis GitHub (bagian Pembaruan di Pengaturan); APK Android release bertanda tangan lewat CI.
- **Deploy**: `infra/scripts/deploy.sh` (build arm64, migrasi, restart, cek `/v1/readyz`, rollback image bila gagal).
- **Uji E2E** desktop (Playwright, stack nyata: gateway, worker, omp) dan Android (Compose UI test melawan gateway nyata), plus audit aksesibilitas axe dan lint desain statis.

### Diubah

- Token warna `text-3` dan `accent` (terang) disesuaikan agar lolos kontras WCAG AA; `docs/DESIGN_SYSTEM.md` diperbarui.
- Animasi skeleton memakai kurva token; `prefers-reduced-motion` tidak lagi menyebabkan animasi berkedip.

### Diketahui

- Kartu Kanban yang butuh izin belum punya UI izin sendiri; izin dijawab dari percakapan kartu (lihat `docs/BACKLOG.md`).
- Auto-update dari repo GitHub privat membutuhkan penyiapan akses rilis (lihat `docs/RELEASE.md`).
