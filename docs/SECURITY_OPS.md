# Keamanan & Operasional — Personal AI OS

Karena worker bisa menjalankan perintah di PC dan gateway memegang akses ke semua model, keamanan dijaga berlapis walau aplikasinya hanya untuk satu orang.

## Jaringan

Hasil audit terakhir dan temuannya ada di `docs/SECURITY_AUDIT.md`; tes `security.audit.integration.test.ts` menjaga auth dan scope setiap route di CI. Di produksi gateway menolak start bila `HOST` bukan loopback kecuali `ALLOW_PUBLIC_BIND=true`.

- Publik hanya 443 (nginx). SSH dibatasi ke Tailscale setelah Tailscale stabil.
- Hermes, 9Router, Postgres, SearXNG, Uptime Kuma hanya di 127.0.0.1.
- Rate limit di gateway: login 5 per menit, API umum 120 per menit per perangkat.
- CORS ditutup; klien bukan browser publik. Desktop memakai origin Tauri yang di-whitelist.

## Identitas dan token

- Satu akun pemilik: password (argon2id) + TOTP. Tanpa pendaftaran publik.
- Token per perangkat dengan scope (`app`, `worker`, `llm`), bisa dicabut dari halaman Perangkat.
- Refresh token dirotasi setiap dipakai; pemakaian ulang token lama mencabut perangkat itu.
- Klien menyimpan token di penyimpanan aman OS (Windows Credential Manager via Tauri, Android Keystore).

## Worker dan eksekusi

- Daftar folder yang diizinkan diatur di aplikasi desktop. Worker menolak path di luar daftar.
- Run coding selalu di git worktree terpisah; branch kerja pengguna tidak disentuh sampai review diterima.
- Approval wajib untuk: perintah shell yang bukan baca, akses jaringan, instalasi paket, penghapusan file. Aturan "selalu izinkan" disimpan per project dan per pola perintah.
- Mode rencana (`planOnly`): worker menolak otomatis setiap permintaan izin (tulis, perintah, jaringan), termasuk yang punya aturan "selalu izinkan". Pembatasan ditegakkan di worker, bukan hanya lewat prompt.
- Batas waktu run default 30 menit, bisa diubah. Proses anak dimatikan saat run selesai.

## Quick Ask (jendela kedua desktop)

- Hanya jendela utama yang memegang sesi (token, refresh, WebSocket). Jendela Quick Ask hanya UI dan bertukar event Tauri dengan jendela utama; capability-nya (`capabilities/quick.json`) tanpa HTTP, WebSocket, atau penyimpanan rahasia. Dua sesi di dua jendela akan saling merotasi refresh token dan memicu pencabutan perangkat.
- Bundel `quick.html` tidak mengimpor `app/services` (diperiksa saat build).
- Menutup jendela utama menutup aplikasi, termasuk jendela Quick Ask yang tersembunyi dan worker.

## Berkas buatan agent (folder kiriman)

- Hermes menulis berkas untuk pemilik ke `/home/ubuntu/aios-outbox/<id-run>/`. Gateway me-mount folder itu read-only (`/outbox`) dan hanya mengambil berkas biasa di dalam folder run yang sedang selesai: symlink dan path yang keluar folder diabaikan, maks 10 berkas, 25 MB per berkas, 50 MB per run.
- Berkas disalin ke tabel `files` (ikut backup) dan diunduh lewat `GET /files/:id/download` (scope `app`) selalu sebagai attachment dengan `nosniff`, tidak pernah dirender di origin gateway.
- Timer `aios-outbox-clean` menghapus isi folder kiriman yang lebih tua dari 24 jam.

## Pratinjau artifact

- Kode buatan AI (HTML, SVG, React, Mermaid) hanya dijalankan di origin terpisah: desktop lewat custom protocol `aiosartifact` di iframe `sandbox="allow-scripts allow-modals"` (tanpa `allow-same-origin`), Android lewat WebView tanpa jembatan JS, tanpa akses berkas atau content provider, dan tanpa navigasi keluar. Skrip artifact tidak bisa membaca token, IPC, atau DOM aplikasi.
- CSP aplikasi desktop tetap melarang skrip inline; hanya `frame-src` yang ditambah `http://aiosartifact.localhost`.
- React, Babel, dan Mermaid dimuat dari jsDelivr dengan versi terkunci dan hash SRI. Mengganti versi berarti memperbarui URL dan hash di `artifact.ts` dan `ArtifactPage.kt` bersamaan (tes Android membandingkan keduanya).

## Rahasia

- `.env` di VPS dengan izin 600, password Postgres lewat Docker secret.
- API key 9Router khusus gateway, terpisah dari key dashboard.
- File service account FCM di `secrets/`, tidak pernah masuk image Docker.
- Log tidak pernah mencetak token, isi `.env`, atau header Authorization.

## Backup dan pemulihan

| Apa | Cara | Frekuensi | Retensi |
| --- | --- | --- | --- |
| Database | `pg_dump -Fc -Z0` lalu restic (dedup + zstd max) ke Oracle Object Storage | Harian | Semua backup 31 hari terakhir; lebih tua dihapus otomatis |
| Data Hermes (memori, skill) | restic folder data Hermes | Harian | Sama |
| Role, skill, konfigurasi | Git (repo privat) | Setiap perubahan | Riwayat git |
| `.env` dan secrets | restic terenkripsi | Setiap perubahan | Sama |

Uji restore ke database sementara minimal sekali sebulan.

## Observability

- Log JSON (pino) dengan `requestId`, `runId`, `deviceId`, rotasi Docker sudah aktif.
- Endpoint `/healthz` (proses hidup) dan `/readyz` (Postgres, Hermes, 9Router, SearXNG terjangkau).
- Uptime Kuma memantau `/readyz` dan mengirim notifikasi ke Telegram bila gagal.
- Halaman Status di aplikasi desktop: versi gateway, status worker, kuota, antrean job.

## Pembaruan

- Versi Hermes, omp, 9Router, SearXNG dikunci dan dicatat di `infra/VERSIONS.md`.
- Upgrade satu komponen per waktu: baca changelog, jalankan tes adapter, baru naikkan versi.
