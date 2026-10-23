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

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 3600s;   # stream panjang dan WebSocket
    client_max_body_size 25m;   # lampiran
}
```

## Yang dipasang di PC Windows

- Git for Windows, Node.js 22 LTS, pnpm, Bun (untuk build worker), Rust stable + Tauri 2 prerequisites (WebView2 sudah ada di Windows 11).
- omp versi Windows native, dengan provider diarahkan ke `https://<domain>/llm/v1` memakai token perangkat.
- Playwright dengan browser Chromium untuk fitur testing preview.
- Android Studio (untuk membangun aplikasi Android) dan JDK 17.
