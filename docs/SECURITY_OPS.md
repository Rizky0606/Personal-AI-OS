# Keamanan & Operasional — Personal AI OS

Karena worker bisa menjalankan perintah di PC dan gateway memegang akses ke semua model, keamanan dijaga berlapis walau aplikasinya hanya untuk satu orang.

## Jaringan

Tinjauan source terbaru untuk persiapan rilis: `docs/SECURITY_REVIEW.md` (bukan audit runtime). Tes `security.audit.integration.test.ts` menjaga auth dan scope setiap route di CI. Di produksi gateway menolak start bila `HOST` bukan loopback kecuali `ALLOW_PUBLIC_BIND=true`.

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
- Folder kerja run coding: run coding chat project bawaannya mengubah folder project langsung di branch yang sedang aktif (mode `in_place`). Run hanya dimulai bila HEAD tidak detached, tidak ada run lain di repo yang sama (atau hasil `in_place` yang menunggu tinjauan), dan working tree bersih (`git status --porcelain` kosong); selain itu run ditolak (`workspace_detached`, `workspace_busy`, `workspace_dirty`). Perintah git agent yang memindahkan HEAD/branch (commit, checkout, switch, reset, stash, rebase, merge, pull, cherry-pick, revert, am, update-ref) ditolak worker otomatis, walau ada aturan "selalu"; penolakan ini berbasis pola perintah, bukan sandbox. Tidak ada commit sebelum pemilik menerima; terima = satu commit di branch aktif, tolak = isi folder kembali ke tree awal (berkas yang diabaikan git seperti `node_modules` dan build tidak pernah disentuh), dan worker tidak pernah menghapus folder project atau branch pemilik. Isolasi git worktree terpisah (branch `aios/*`, branch kerja tidak disentuh sampai review diterima) tetap wajib untuk tim Orca, armada, kartu kanban, dan jadwal, dan bisa dipilih per project (setup) atau per pesan. Worker hanya menghapus worktree di lokasi miliknya (`.aios-worktrees` atau `<data>/worktrees`, branch `aios/*`).
- Setup project: mode folder kerja (`workspace`), perintah setup, dan opsi tautan node_modules disimpan di worker (`project-setup.json`), hanya diubah pemilik dari desktop. Isi repo tidak pernah menentukan apa yang dijalankan otomatis. Perintah setup berjalan tanpa shell di worktree run (batas 5 menit, dimatikan bersama run), karakter shell ditolak, dan tidak dijalankan pada mode rencana. Tautan node_modules bawaannya mati karena memberi agent akses tulis ke node_modules asli di luar worktree. Pada mode `in_place` agent bekerja di folder project yang sudah punya `node_modules`, jadi tulisan ke sana (tetap lewat approval) tidak dibatalkan oleh tolak.
- LSP agent: server bahasa dijalankan omp sebagai proses anak hanya bila ditemukan di folder kerja run (`node_modules/.bin`) atau PATH; ikut mati bersama run (diperiksa di Windows). Dapat dimatikan per project dari setup project.
- Catatan "Dependensi worktree" (docs/DESIGN_PRESISI_AGENT.md): bila worktree punya `package.json` tanpa `node_modules`, worker hanya menulis ke pesan sistem perintah instal yang disarankan (sesuai lockfile); worker sendiri tidak menjalankan apa pun. Agent menjalankannya lewat approval biasa, jadi skrip lifecycle paket (mis. `postinstall`) baru berjalan setelah pemilik mengizinkan perintah itu.
- Approval wajib untuk: perintah shell yang bukan baca, akses jaringan, instalasi paket, penghapusan file. Aturan "selalu izinkan" disimpan per project dan per pola perintah.
- Cari di web: kueri dibuat model kecil dari pesan pemilik dan percakapan, jadi teks percakapan terkirim ke SearXNG (di host sendiri, tidak publik) sebagai kueri. Halaman hasil dibaca dengan pengambil halaman aman SSRF yang sama dengan riset; isinya ditempel sebagai data dengan peringatan untuk mengabaikan instruksi di dalamnya.
- Aksi git (tab Git): worker menjalankan `add`, `restore`, `clean -f -- <satu berkas>`, `commit -m`, `switch <branch lokal yang ada>`, `pull --ff-only`, dan `push` (tanpa `--force`) hanya di folder project yang terikat dan atas perintah pemilik dari desktop; buang perubahan dan push meminta konfirmasi di UI. Path divalidasi, nama branch dicocokkan dengan daftar branch lokal (tidak pernah jadi opsi git), tanpa prompt kredensial, dan pesan galat dibersihkan dari kredensial di URL. Agent tidak memakai jalur ini.
- Tab Git (baca): worker menjalankan `git status`, `diff`, `log`, `ls-files`, dan `rev-parse` (hanya baca) di folder project yang terikat, dengan `GIT_OPTIONAL_LOCKS=0` supaya indeks tidak ditulis, tanpa prompt kredensial, batas waktu dan ukuran keluaran. Path berkas divalidasi (relatif, tanpa `..`, tanpa awalan `-`).
- Tautan di pesan: gateway mengambilnya dengan pengambil halaman riset (hanya http/https, alamat privat dan redirect ke sana ditolak, ukuran dan waktu dibatasi, maks. 3 tautan, 8.000 karakter per halaman). Isinya ditempel sebagai data dengan peringatan untuk mengabaikan instruksi di dalamnya; worker hanya mengizinkan otomatis izin jaringan untuk URL yang persis tertulis di pesan pemilik.
- Mode rencana (`planOnly`): worker menolak otomatis setiap permintaan izin (tulis, perintah, jaringan), termasuk yang punya aturan "selalu izinkan". Pengecualian hanya tool gateway yang membaca: `web_search`/`web_read` tetap lewat aturan atau ditanyakan seperti biasa, tool data (`memory_list`, `space_search`, `task_list`, `schedule_list`) diizinkan diam-diam; tool usulan tetap ditolak (keputusan pemilik, `docs/DESIGN_MCP_TOOLS.md` #5). Pembatasan ditegakkan di worker, bukan hanya lewat prompt.
- Tool gateway lewat MCP (`aios_tools`, `MCP_TOOLS_ENABLED`, bawaan mati): agent omp bisa memanggil `web_search` dan `web_read` sendiri. omp hanya memegang token lokal acak per run untuk relay loopback di worker; token perangkat tetap di worker dan gateway mengikat setiap panggilan ke run yang sedang berjalan di project worker itu (`X-Aios-Run-Id` dari relay). Izinnya berjenis jaringan dan ditanyakan; "selalu izinkan" disimpan per nama tool per project, bukan per kueri. `web_read` hanya membuka URL dari hasil `web_search` run itu atau dari pesan pemilik (halaman jahat tidak bisa menyuruh agent membuka alamat buatan berisi data pribadi), memakai pengambil halaman aman SSRF yang sama dengan riset. Hasil dipagari `<<< >>>` sebagai data dengan peringatan untuk mengabaikan instruksi di dalamnya. Kueri yang tampak memuat rahasia ditolak, tetapi kueri tetap dikirim ke mesin pencari hulu lewat SearXNG (sama dengan "Cari di web"). Batas: 60 permintaan per menit per worker, 15 pencarian dan 15 halaman per run; setiap panggilan tool tercatat di `audit_log` (`mcp.tool_called`, tanpa argumen atau isi).
- Tool usulan `aios_tools` (`memory_propose`, `task_propose`, `schedule_propose`): agent tidak pernah membuat memori, kartu, atau jadwal; ia hanya membuat usulan yang menunggu pemilik (persetujuan = klaim atomik, satu keputusan saja). `memory_propose` lewat penjaga ekstraksi memori: kutipan wajib ada apa adanya di pesan pemilik (teks yang dibaca agent dari web, dokumen, atau kode tidak bisa menjadi memori), pemindai injeksi, rahasia, satu kalimat, dedup, ≤20 usulan menunggu. Kartu hanya untuk project run itu. Jadwal usulan memakai validasi cron yang sama dan baru dibuat (dan berjalan) setelah disetujui; target hanya `chat`/`research`, tanpa role. Teks berpola rahasia ditolak; 3 usulan per run, 10 per jenis per hari. Mode rencana: worker menolak izin tool usulan dan gateway menolak usulan dari run `planOnly`. Usulan yang dibuat setelah run memakai tool web ditandai `afterWeb` dan ditampilkan dengan peringatan saat meninjau. Audit hanya id dan jenis, tanpa isi.
- Hermes di `aios_tools` (`MCP_HERMES_TOKEN_SHA256`, bawaan kosong = mati): token layanan opak acak 32 byte; gateway hanya menyimpan SHA-256-nya di `gateway.env` dan membandingkan dengan waktu tetap; token hanya di `~/.hermes/.env`. Diterima hanya langsung dari loopback (alamat soket, bukan `X-Forwarded-For`) dan tanpa header proxy, jadi token yang bocor tidak berguna dari internet lewat nginx. Token itu tidak membuka rute lain. Hermes tidak terikat run: tanpa tool kanban, anggaran per jam, `web_read` hanya ke URL hasil pencarian jam itu atau pesan pemilik chat umum terbaru. Hermes dikonfigurasi tanpa `trust: untrusted` dan hanya untuk platform `api_server` (`no_mcp` di platform lain); tool tulis tetap hanya membuat usulan. Rotasi/pencabutan: ganti atau kosongkan hash lalu restart gateway (docs/RUNBOOK_HERMES_MCP.md).
- Konektor MCP pihak ketiga (`docs/DESIGN_MCP_KONEKTOR.md`, bawaan tidak ada): pemilik mendaftarkan server MCP jarak jauh; **gateway** yang menjadi kliennya, jadi tokennya tidak pernah meninggalkan VPS dan tidak pernah masuk berkas atau lingkungan omp (omp hanya memegang token loopback acak per run, seperti `aios_tools`). Token disimpan terenkripsi AES-256-GCM dengan kunci HKDF dari `AUTH_SECRET` dan tidak bisa dibaca balik lewat API, log, audit, atau pesan galat. URL wajib https tanpa userinfo di port 443 dan bukan alamat privat (`assertFetchableUrl` + `guardedLookup` saat koneksi), dicek ulang pada setiap hop redirect yang juga wajib tetap di origin yang sama. Hanya tool yang dipilih pemilik yang terlihat agent; `readOnlyHint` yang hilang dianggap **menulis**. Setiap panggilan ditanyakan (jenis jaringan) dan "selalu izinkan" disimpan per konektor + nama tool, bukan per argumen; mode rencana ditolak worker dan tool tulis ditolak lagi di gateway. Anggaran 20 panggilan per run dan 200 per konektor per 24 jam. Hasil dipagari `<<< >>>` sebagai data, konten non-teks dibuang. Audit `mcp.connector_called` tanpa argumen dan tanpa isi. **Risiko sisa yang diterima:** menyetujui tool tulis berarti argumen yang ditulis model dikirim ke pihak ketiga; itu memang maksud fiturnya, yang dijamin adalah pemilik melihatnya lebih dulu.
- Batas waktu run default 30 menit, bisa diubah. Proses anak dimatikan saat run selesai.

## Quick Ask (jendela kedua desktop)

- Hanya jendela utama yang memegang sesi (token, refresh, WebSocket). Jendela Quick Ask hanya UI dan bertukar event Tauri dengan jendela utama; capability-nya (`capabilities/quick.json`) tanpa HTTP, WebSocket, atau penyimpanan rahasia. Dua sesi di dua jendela akan saling merotasi refresh token dan memicu pencabutan perangkat.
- Bundel `quick.html` tidak mengimpor `app/services` (diperiksa saat build).
- Menutup jendela utama menutup aplikasi, termasuk jendela Quick Ask yang tersembunyi dan worker.

## Berkas buatan agent (folder kiriman)

- Screenshot worker hanya menerima body PNG mentah dengan token scope `worker`, metadata `runId`, batas 10 MiB, serta pemeriksaan run aktif dan kepemilikan device/project. Event hanya metadata; unduhan memakai endpoint terautentikasi dengan `nosniff`, `attachment`, dan `no-store`. SVG/HTML tidak inline.
- Hermes menulis berkas untuk pemilik ke `/home/ubuntu/aios-outbox/<id-run>/`. Gateway me-mount folder itu read-only (`/outbox`) dan hanya mengambil berkas biasa di dalam folder run yang sedang selesai: symlink dan path yang keluar folder diabaikan, maks 10 berkas, 25 MB per berkas, 50 MB per run.
- Berkas disalin ke tabel `files` (ikut backup) dan diunduh lewat `GET /files/:id/download` (scope `app`) selalu sebagai attachment dengan `nosniff`, tidak pernah dirender di origin gateway.
- Timer `aios-outbox-clean` menghapus isi folder kiriman yang lebih tua dari 24 jam.

## Pratinjau artifact

- Kode buatan AI (HTML, SVG, React, Mermaid) hanya dijalankan di origin terpisah: desktop lewat custom protocol `aiosartifact` di iframe `sandbox="allow-scripts allow-modals"` (tanpa `allow-same-origin`), Android lewat WebView tanpa jembatan JS, tanpa akses berkas atau content provider, dan tanpa navigasi keluar. Skrip artifact tidak bisa membaca token, IPC, atau DOM aplikasi.
- Event `artifact.created` tidak membawa byte. Desktop hanya menampilkan gambar PNG/JPEG/WebP/GIF inline melalui unduhan terautentikasi; SVG, HTML, dan MIME lain tetap attachment/teks, tidak dieksekusi sebagai gambar arbitrary.
- CSP aplikasi desktop tetap melarang skrip inline; hanya `frame-src` yang ditambah `http://aiosartifact.localhost`.
- React, Babel, dan Mermaid dimuat dari jsDelivr dengan versi terkunci dan hash SRI. Mengganti versi berarti memperbarui URL dan hash di `artifact.ts` dan `ArtifactPage.kt` bersamaan (tes Android membandingkan keduanya).

## Rahasia

- `.env` di VPS dengan izin 600, password Postgres lewat Docker secret.
- API key 9Router khusus gateway, terpisah dari key dashboard.
- File service account FCM di `secrets/`, tidak pernah masuk image Docker.
- Log tidak pernah mencetak token, isi `.env`, atau header Authorization.

## Pasang skill dari luar

- Sumber luar (skills.sh, GitHub, aitmpl.com) hanya diunduh gateway dari daftar domain tetap; pengalihan ke domain lain ditolak.
- aitmpl.com hanya mengimpor tipe `skills`. Tipe lain (agents, commands, hooks, mcps, settings, dan sejenisnya) yang bisa membawa kode atau mengubah konfigurasi ditolak `422 skill_type_not_importable` sebelum ada permintaan jaringan.

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
