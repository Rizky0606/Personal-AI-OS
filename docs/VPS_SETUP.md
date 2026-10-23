# Instalasi VPS — Personal AI OS

VPS butuh 4 kelompok: dasar sistem, runtime, tools agent, dan stack aplikasi. Hermes, omp, dan 9Router sudah terpasang, jadi cukup dikonfigurasi ulang. Yang benar-benar baru: PostgreSQL, SearXNG, backend gateway, backup, dan Tailscale.

## Daftar komponen

| Komponen | Status | Wajib | Bind / port | Catatan |
| --- | --- | --- | --- | --- |
| Ubuntu ARM64 + unattended-upgrades | Ada | Wajib | — | Update keamanan otomatis |
| Swap 2 GiB | Sudah | Wajib | — | Penting saat build image di ARM |
| Firewall (iptables + Security List Oracle) | Cek | Wajib | 22, 80, 443 | Port lain ditutup dari luar |
| fail2ban | Baru | Wajib | — | Lindungi SSH |
| Docker Engine + Compose + log rotation | Sudah | Wajib | — | Rotasi log sudah ada di daemon.json |
| git, build-essential, ripgrep, fd-find, jq, tmux | Cek | Wajib | — | Dipakai agent dan skrip |
| Node.js 22 LTS + pnpm (corepack) | Baru | Wajib | — | Skrip migrasi dan tooling di host |
| Python 3.11+ dan uv | Sudah | Wajib | — | Dipakai Hermes |
| Hermes Agent | Sudah | Wajib | 127.0.0.1:8642 (API), 127.0.0.1:9119 (dashboard) | Aktifkan API server, jalankan sebagai service systemd |
| 9Router | Sudah | Wajib | 127.0.0.1:20128 | Dashboard hanya lewat Tailscale atau SSH tunnel |
| omp | Sudah | Opsional | stdio | Untuk role coding di repo yang di-clone ke VPS |
| PostgreSQL 16 | Baru | Wajib | 127.0.0.1:5432 | Docker, volume persisten |
| SearXNG | Baru | Wajib untuk riset | 127.0.0.1:8888 | Docker, format JSON aktif |
| Backend gateway | Baru (kode sendiri) | Wajib | 127.0.0.1:3000 | Docker dengan `network_mode: host` |
| nginx + Let's Encrypt | Sudah | Wajib | 443 publik | Vhost ke gateway, dukung WebSocket |
| restic + Oracle Object Storage | Baru | Wajib | — | Backup harian, terenkripsi |
| Tailscale | Baru | Dianjurkan | 100.x | Akses admin: SSH, dashboard 9Router dan Hermes |
| Uptime Kuma | Baru | Opsional | 127.0.0.1:3001 | Pantau layanan, notifikasi ke Telegram |
| Chromium headless (Playwright) | Baru | Opsional | — | Riset halaman yang butuh JavaScript, dipasang di image gateway |
| Firebase project (FCM) | Baru | Wajib untuk notifikasi Android | — | File service account disimpan sebagai secret |

**Kenapa gateway pakai `network_mode: host`:** dari dalam container, `127.0.0.1` adalah container itu sendiri, bukan VPS. Mode host membuat gateway bisa memanggil Hermes dan 9Router di localhost tanpa membuka port mereka ke jaringan Docker.

## Urutan setup

1. Hardening: update sistem, unattended-upgrades, fail2ban, cek firewall hanya membuka 22, 80, 443.
2. Pasang Tailscale. Setelah tersambung, pertimbangkan membatasi SSH hanya dari Tailscale.
3. Pasang Node.js 22 LTS, lalu `corepack enable` untuk pnpm.
4. Hermes: aktifkan API server (`API_SERVER_ENABLED=true`, `API_SERVER_KEY=<acak 32 byte>`), pastikan bind ke 127.0.0.1, jalankan sebagai service systemd, uji dengan `curl` ke `/v1/models`.
5. 9Router: pastikan hanya bind ke 127.0.0.1, buat API key khusus gateway, matikan tunnel publik yang tidak dipakai.
6. Buat folder `/srv/personal-ai-os` berisi `docker-compose.yml`, `.env`, dan `secrets/` (izin 600).
7. Jalankan PostgreSQL dan SearXNG lewat compose, lalu gateway setelah kodenya siap (Fase 3).
8. nginx: tambah vhost ke 127.0.0.1:3000 dengan dukungan WebSocket.
9. Backup: restic ke Oracle Object Storage, jadwal harian lewat systemd timer, uji restore sekali.
10. Opsional: Uptime Kuma untuk memantau gateway, Hermes, 9Router, dan SearXNG.

## Kerangka docker-compose

```yaml
services:
  postgres:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_DB: aios
      POSTGRES_USER: aios
      POSTGRES_PASSWORD_FILE: /run/secrets/pg_password
    secrets: [pg_password]
    volumes: [pgdata:/var/lib/postgresql/data]
    ports: ["127.0.0.1:5432:5432"]

  searxng:
    image: searxng/searxng:latest   # kunci ke tag versi saat setup
    restart: unless-stopped
    volumes: [./searxng:/etc/searxng]
    ports: ["127.0.0.1:8888:8080"]

  gateway:
    image: aios-gateway:latest
    restart: unless-stopped
    network_mode: host               # akses Hermes dan 9Router di localhost
    env_file: .env
    depends_on: [postgres]

secrets:
  pg_password:
    file: ./secrets/pg_password

volumes:
  pgdata:
```

## Vhost nginx

Contoh lengkap (TLS, redirect, WebSocket, batas ukuran, rate limit kasar, header keamanan, hanya `/v1` dan `/llm/v1` yang diteruskan) ada di `infra/nginx/aios.conf.example`. Gateway percaya `X-Forwarded-For` hanya dari `127.0.0.1` (nginx di host yang sama); jangan memasang nginx di host lain tanpa mengubah `trustProxy`.

## Backup, restore, dan pemantauan (Fase 23)

Semua skrip ada di `infra/scripts`; unit systemd di `infra/systemd`. Skrip diuji dengan perintah palsu lewat `bash infra/scripts/selftest.sh` (jalan di CI); yang belum pernah dijalankan adalah restic/Docker/Oracle sungguhan.

### Backup harian

1. Pasang restic (`apt install restic`) dan buat bucket Oracle Object Storage beserta Customer Secret Key (API S3-compatible).
2. `sudo mkdir -p /etc/aios && sudo cp infra/scripts/backup.env.example /etc/aios/backup.env`, isi `RESTIC_REPOSITORY`, kunci akses, `COMPOSE_DIR`, dan `HERMES_DATA_DIR`; `sudo chmod 600 /etc/aios/backup.env`.
3. Buat kata sandi repositori: `openssl rand -base64 32 | sudo tee /etc/aios/restic-password` lalu `chmod 600`. **Simpan salinannya di luar VPS** (pengelola kata sandi): tanpanya backup tidak bisa dibuka.
4. `sudo -E restic init` (sekali; dengan variabel dari `backup.env`), lalu uji manual: `sudo infra/scripts/backup.sh`.
5. Pasang timer: `sudo cp infra/systemd/aios-*.{service,timer} /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now aios-backup.timer aios-restore-test.timer`. Sesuaikan `ExecStart` bila repo tidak di `/srv/personal-ai-os`.

Yang dicadangkan: dump `pg_dump -Fc` database, folder data Hermes, `.env`, `gateway.env`, dan `secrets/` (restic mengenkripsi seluruh repositori). Retensi 7 harian, 4 mingguan, 6 bulanan; cek integritas ringan tiap hari.

### Uji restore

`sudo infra/scripts/restore.sh` memulihkan snapshot terbaru ke database **sementara** (`aios_restore_<waktu>`), memeriksa tabel inti dan migrasi, mencetak jumlah baris untuk dibandingkan dengan produksi, lalu menghapusnya. Tidak menyentuh database `aios`. Opsi: `--keep` (pertahankan database sementara), `--snapshot ID`, `--target-dir D` (pulihkan juga file Hermes dan konfigurasi ke folder D). Timer bulanan menjalankannya otomatis; jalankan manual sekali setelah backup pertama.

### Uptime Kuma + Telegram

`cd infra/compose && docker compose --profile monitoring up -d uptime-kuma` (isi `KUMA_TAG` di `.env`). Dashboard di `127.0.0.1:3001`; buka lewat Tailscale atau `ssh -L 3001:127.0.0.1:3001`. Di UI Kuma:

1. Buat bot lewat @BotFather, simpan token; kirim pesan ke bot lalu ambil `chat_id` (`https://api.telegram.org/bot<token>/getUpdates`).
2. Settings > Notifications > Setup Notification > Telegram, isi token dan chat id, centang "Default enabled", Test.
3. Monitor HTTP: `http://127.0.0.1:3000/v1/readyz` (interval 60 dtk, terima status 200 saja; 503 berarti ada dependensi mati), `http://127.0.0.1:3000/v1/healthz`.
4. Dua monitor tipe **Push** untuk backup dan uji restore; salin URL push-nya ke `KUMA_PUSH_URL` dan `KUMA_RESTORE_PUSH_URL` di `backup.env`. Set "heartbeat interval" 26 jam (backup) dan 33 hari (restore) agar backup yang tidak jalan juga memicu notifikasi.

Token bot tersimpan di database Kuma (volume `kumadata`), bukan di repo.

### Cek versi tool

`infra/scripts/check-versions.sh` membandingkan omp, 9Router, Hermes, SearXNG, PostgreSQL, dan Node di VPS dengan blok kunci di `infra/VERSIONS.md`. Kode keluar 1 bila berbeda atau tidak terpasang (`--lenient` hanya melaporkan). Jalankan sebelum dan sesudah upgrade; isi kunci Hermes dan SearXNG saat pertama kali dicek.

### Tes beban ringan

Dari mesin mana pun yang bisa menjangkau gateway (idealnya dari VPS agar sampel sumber daya terbaca):

```bash
# Token dari perangkat uji khusus (login sekali lewat POST /v1/auth/login); jangan dibagikan.
AIOS_URL=https://aios.contoh.com AIOS_TOKEN=<access> AIOS_REFRESH_TOKEN=<refresh>   node infra/scripts/loadtest.mjs --out beban.json
```

Menjalankan 5 run chat bersamaan dan 1 riset `deep`, lalu mencetak waktu tiap pekerjaan dan, di Linux, CPU (rata-rata dan puncak), memori terpakai, swap, serta RSS puncak gateway, Hermes, 9Router, Postgres, dan Chromium. Catat hasilnya di `docs/BACKLOG.md`. Untuk membandingkan sebelum dan sesudah perubahan, simpan `beban.json`.

## Yang dipasang di PC Windows

- Git for Windows, Node.js 22 LTS, pnpm, Bun (untuk build worker), Rust stable + Tauri 2 prerequisites (WebView2 sudah ada di Windows 11).
- omp versi Windows native, dengan provider diarahkan ke `https://<domain>/llm/v1` memakai token perangkat.
- Playwright dengan browser Chromium untuk fitur testing preview.
- Android Studio (untuk membangun aplikasi Android) dan JDK 17.
