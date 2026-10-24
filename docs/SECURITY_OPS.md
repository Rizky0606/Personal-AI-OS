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
- Batas waktu run default 30 menit, bisa diubah. Proses anak dimatikan saat run selesai.

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
