# Audit keamanan — Fase 23

Dilakukan terhadap kode di cabang `feat/23-hardening` (setelah Fase 22). Cakupannya: setiap endpoint punya auth dan scope yang benar, rate limit aktif, log bebas rahasia, worker menolak path dan perintah sesuai aturan, plus pemeriksaan dependensi, rahasia di repo, dan konfigurasi jaringan.

Metode utamanya dibuat sebagai **tes yang berjalan di CI**, bukan pemeriksaan sekali jalan, supaya route baru yang lupa dijaga langsung membuat build gagal: `apps/gateway/src/security.audit.integration.test.ts`.

## Ringkasan

| Tingkat | Temuan | Status |
| --- | --- | --- |
| Tinggi | Tidak ada | - |
| Sedang | S-1 Gateway bisa dijalankan dengan `HOST=0.0.0.0` di produksi (terbuka ke internet, melewati nginx dan TLS) | Diperbaiki |
| Sedang | S-2 `pnpm audit` (dev): esbuild < 0.25 lewat `drizzle-kit` (CORS dev server) | Diterima, hanya devDependency |
| Rendah | S-3 Kontrak memuat `POST /files` yang belum punya route | Diterima, ditunda (lampiran) |
| Rendah | S-4 Terminal desktop tidak dibatasi cwd setelah dibuka | Disengaja, didokumentasikan |
| Rendah | S-5 Proxy preview worker tidak butuh token (loopback saja) | Diterima, didokumentasikan |
| Info | S-6 Konfigurasi nginx, firewall, dan permission file di VPS tidak bisa diperiksa dari repo | Contoh disediakan, belum diverifikasi di VPS |

## Yang diperiksa dan hasilnya

### 1. Auth dan scope setiap endpoint

Tes membaca daftar route yang **benar-benar terdaftar** di Fastify (hook `onRoute`), bukan daftar tulisan tangan, lalu:

- Semua route kecuali empat yang publik (`GET /healthz`, `GET /readyz`, `POST /auth/login`, `POST /auth/refresh`) menolak permintaan **tanpa token (401)** dan **dengan token palsu (401)**.
- Token perangkat `worker` (scope `worker` + `llm`) ditolak **403** di semua route aplikasi; token `app` ditolak 403 di `/v1/worker/ws` dan `/llm/v1/*`. `POST /auth/logout` cukup login.
- Daftar route REST **sama persis dengan kontrak** (`packages/contracts`): tidak ada route tanpa kontrak. Satu-satunya kontrak tanpa route: `POST /files` (S-3).
- Hasil: tidak ada route yang terbuka atau salah scope (51 route diperiksa).

Pemeriksaan tambahan dari fase sebelumnya yang tetap lulus: refresh token dirotasi dan pemakaian ulang mencabut perangkat; token dicabut langsung ditolak; `/llm/v1/*` menolak path traversal ke API 9Router (`/../api/keys`, `%2e%2e`); header `Authorization` perangkat tidak diteruskan ke 9Router.

### 2. Rate limit

Login 5 per menit per IP, refresh 20, API umum 120 per menit per perangkat (diuji di `devices.integration.test.ts`: login dan umum per perangkat); `/healthz` dan `/readyz` sengaja tanpa batas agar pemantau tidak terblokir. Contoh nginx (`infra/nginx/aios.conf.example`) menambah batas kasar di depannya.

### 3. Log bebas rahasia

Tes menjalankan login (salah dan benar), request terautentikasi, panggilan proxy model dengan isi pesan, dan logout dengan logger menulis ke penampung, lalu memastikan keluarannya **tidak memuat**: password, kode TOTP, access token, refresh token, API key 9Router, dan isi pesan model. Pino meredaksi `Authorization` dan `Cookie`. Skrip backup/restore tidak mencetak isi `backup.env` (diuji di `infra/scripts/selftest.sh`). Worker menulis log ke stderr tanpa token; `AIOS_WORKER_TOKEN` dibuang dari lingkungan proses dan dari lingkungan shell terminal.

### 4. Worker menolak path dan perintah

Sudah dicakup tes dari Fase 17-19 dan dipertahankan: path di luar folder izin, `..`, symlink/junction keluar, UNC, namespace perangkat Windows, root drive, dan folder home ditolak (`paths.test.ts`); proses anak tanpa shell dan hanya di cwd yang diizinkan, batas jumlah dan waktu, dimatikan bersama turunannya (`manager.test.ts`); approval `always-ask` dipaksa di adapter omp; WebSocket lokal menolak header `Origin`, token sekali pakai, dan hanya mendengarkan di loopback (`worker.test.ts`). Tambahan Fase 21-22 yang diperiksa: server MCP browser (loopback, token per run dengan `timingSafeEqual`, sesi hanya untuk origin preview run itu); junction `node_modules` dilepas sebelum worktree dihapus; shell terminal tanpa variabel `AIOS_*`.

### 5. Dependensi dan rahasia di repo

- `pnpm audit --prod`: **tidak ada kerentanan**. `pnpm audit` penuh: 1 moderat (S-2).
- Pemindaian pola kunci (sk-, AKIA, ghp_, xox, AIza, blok kunci privat) di semua file terlacak git: **nol temuan** di luar tes dan fixture. Tidak ada `.env`, `secrets/`, `google-services.json`, `.pem`, atau `.key` yang terlacak; `.gitignore` menutupnya.

## Temuan dan perbaikan

**S-1 (sedang, diperbaiki).** Dengan `network_mode: host`, `HOST=0.0.0.0` di `gateway.env` membuka port 3000 langsung ke internet tanpa TLS dan tanpa nginx. Hanya komentar di contoh env yang melarangnya. Perbaikan: `loadConfig` menolak start bila `NODE_ENV=production` dan `HOST` bukan loopback, kecuali `ALLOW_PUBLIC_BIND=true` diisi sengaja (`apps/gateway/src/config.ts`, tes di `config.test.ts`).

**S-2 (diterima).** `esbuild` lewat `drizzle-kit` hanya dipakai saat pengembangan (generate migrasi); tidak ada di image produksi (`pnpm deploy --prod`). Naikkan saat `drizzle-kit` merilis versi yang memakai esbuild >= 0.25.

**S-3 (diterima).** `POST /files` ada di kontrak tetapi belum dibuat (lampiran ditunda sejak Fase 16). Tes audit menandainya eksplisit (`DEFERRED`); menghapusnya dari daftar itu tanpa membuat route akan menggagalkan tes.

**S-4 (disengaja).** Terminal adalah alat kerja pengguna: cwd awal hanya folder project atau worktree terikat, setelah itu pengguna bebas berpindah. Batas "worker tidak menulis di luar worktree" berlaku untuk agent. Akses terminal hanya lewat WebSocket lokal bertoken.

**S-5 (diterima).** Proxy preview mendengarkan di `127.0.0.1:<port acak>` dan meneruskan ke dev server proyek tanpa token; proses lain di PC yang sama bisa membukanya, sama seperti dev server aslinya. Tidak ada rahasia yang lewat di sana.

## Belum bisa diverifikasi dari repo

- Isi nginx, firewall (iptables + Security List Oracle), fail2ban, dan izin file (`.env` 600) di VPS. `infra/nginx/aios.conf.example` dan `docs/VPS_SETUP.md` memuat konfigurasi yang dimaksud, tetapi belum dijalankan.
- Rate limit di belakang nginx nyata: `trustProxy` hanya percaya `127.0.0.1`; bila nginx berada di host lain, IP klien akan salah terbaca.
- Penetration test oleh pihak luar tidak dilakukan.
