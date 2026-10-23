# Rangkaian Prompt Build — Personal AI OS

Ada 25 prompt dalam 6 tahap: fondasi, inti server, Android, desktop, coding agent, dan rilis. Jalankan berurutan, satu prompt per sesi agent, dan selalu tempel *Preamble* di depan setiap prompt. Server dibangun dulu karena Android dan Windows sama-sama bergantung padanya.

## Preamble (tempel di awal setiap prompt)

```text
Kamu senior engineer yang membangun Personal AI OS, aplikasi AI agent pribadi (Windows + Android) dengan server di VPS.
Sebelum menulis kode:
1. Baca AGENTS.md dan dokumen docs/ yang disebut di prompt ini.
2. Baca kode yang sudah ada di folder yang akan kamu sentuh.
3. Tulis rencana singkat: file yang dibuat atau diubah, langkah, cara verifikasi. Lalu kerjakan.
Aturan:
- Kerjakan hanya scope fase ini. Ide lain catat di docs/BACKLOG.md.
- Jangan menambah dependensi di luar yang disebut, kecuali perlu dan dijelaskan alasannya.
- Semua skema dan event lewat packages/contracts. Semua mesin agent lewat packages/adapters.
- UI wajib mengikuti docs/DESIGN_SYSTEM.md, termasuk daftar larangan anti AI slop.
Selesai berarti: lint, typecheck, dan tes lulus, lalu tulis ringkasan berisi perubahan, daftar file, cara uji manual, asumsi, dan sisa pekerjaan.
```

## Tahap A — Fondasi

### Fase 0 — Verifikasi tools (jalankan di VPS, sebelum repo dibuat)

```text
Tujuan: memastikan cara integrasi Hermes, omp, dan 9Router sebelum kode dibangun. JANGAN menulis kode aplikasi.
Kerjakan dan dokumentasikan hasilnya di VERIFICATION.md:
1. Hermes API server: konfirmasi cara mengaktifkan (API_SERVER_ENABLED, API_SERVER_KEY), port, endpoint yang tersedia (/v1/models, /v1/chat/completions, dan lainnya), dukungan streaming SSE, cara menjaga sesi atau memori per percakapan, cara mengirim system prompt, dan cara memakai skills. Uji dengan curl, simpan contoh request dan response.
2. omp: konfirmasi `omp --mode rpc`: format pesan masuk dan keluar (contoh JSON nyata), daftar perintah (prompt, abort, set_model, dan lain-lain), event approval atau izin tool, cara menetapkan provider OpenAI-compatible kustom (base URL + key), dan cara menyuntik system prompt atau skill tambahan tanpa menulis file ke repo kerja (flag, env, atau folder config).
3. 9Router: daftar model dan combo via /v1/models, cara membuat API key terpisah, endpoint kuota atau usage bila ada, endpoint STT bila ada.
4. Versi pasti setiap tool saat ini.
Keluaran: VERIFICATION.md dengan bagian per tool, contoh nyata, dan daftar hal yang TIDAK didukung. Jika sesuatu tidak bisa dipastikan, tulis "tidak terverifikasi" beserta alasannya.
```

### Fase 1 — Scaffold monorepo dan dokumen

```text
Dokumen: paket dokumen (AGENTS.md + docs/) dan VERIFICATION.md dari Fase 0.
Tujuan: repo personal-ai-os siap dikembangkan.
Kerjakan:
1. Buat monorepo pnpm + Turborepo sesuai "Struktur monorepo" di docs/ARCHITECTURE.md: apps/gateway, apps/desktop, apps/worker, apps/android (placeholder README), packages/contracts, ui-tokens, adapters, roles, config, infra/compose, infra/scripts, docs/.
2. Salin AGENTS.md ke root dan semua file docs/ dari paket dokumen ke docs/. Salin VERIFICATION.md ke docs/. Jika VERIFICATION.md berbeda dari asumsi dokumen, catat perbedaannya di docs/BACKLOG.md.
3. packages/config: tsconfig dasar strict, ESLint flat config, Prettier.
4. Skrip root: dev, build, lint, typecheck, test, format.
5. GitHub Actions: lint, typecheck, test untuk setiap push.
6. .gitignore, .editorconfig, .env.example per app, docs/BACKLOG.md kosong, infra/VERSIONS.md berisi versi dari Fase 0.
Jangan: menulis fitur apa pun.
Selesai jika: pnpm install, pnpm lint, pnpm typecheck berjalan bersih di repo kosong.
```

### Fase 2 — Kontrak dan token desain

```text
Dokumen: docs/API_CONTRACT.md, docs/DESIGN_SYSTEM.md.
Tujuan: satu sumber kebenaran untuk tipe data dan token visual.
Kerjakan:
1. packages/contracts: skema Zod untuk semua entitas di "Model data inti", request dan response setiap endpoint REST, envelope WebSocket, union AgentEvent lengkap, status run, error RFC 9457. Ekspor tipe dengan z.infer.
2. Generator OpenAPI dari skema (zod-to-openapi) ke packages/contracts/openapi.json untuk dipakai Android.
3. Tes kontrak: contoh valid dan tidak valid untuk setiap AgentEvent.
4. packages/ui-tokens: tokens.json berisi warna (terang dan gelap, OKLCH), tipografi, spasi, radius, gerak, sesuai tabel di DESIGN_SYSTEM.md. Skrip build yang menghasilkan tokens.css (CSS variables + @theme Tailwind v4) dan Tokens.kt (objek Kotlin untuk Compose).
Jangan: membuat endpoint atau UI.
Selesai jika: tes kontrak lulus dan kedua file token ter-generate.
```

### Fase 3 — Fondasi gateway

```text
Dokumen: docs/ARCHITECTURE.md, API_CONTRACT.md (model data), CODING_STANDARDS.md (bagian Gateway), SECURITY_OPS.md.
Tujuan: gateway Fastify yang bisa dideploy, dengan database dan kesehatan layanan.
Kerjakan:
1. apps/gateway: Fastify + TypeScript, konfigurasi env tervalidasi Zod, logger pino dengan requestId.
2. Drizzle: skema semua tabel di "Model data inti", migrasi awal, skrip migrate.
3. Endpoint /healthz dan /readyz (cek Postgres, Hermes, 9Router, SearXNG dengan timeout pendek).
4. Penanganan error global ke format RFC 9457.
5. Dockerfile multi-stage untuk linux/arm64, user non-root.
6. infra/compose/docker-compose.yml sesuai kerangka di VPS_SETUP.md (postgres, searxng, gateway dengan network_mode host).
7. Tes integrasi /readyz dengan Postgres tes.
Jangan: auth, chat, atau adapter.
Selesai jika: docker compose up menyalakan semuanya di VPS dan /readyz melaporkan status tiap dependensi.
```

### Fase 4 — Auth dan perangkat

```text
Dokumen: docs/SECURITY_OPS.md (Identitas dan token), API_CONTRACT.md (Auth, Perangkat).
Tujuan: login satu pemilik dengan perangkat terdaftar.
Kerjakan:
1. Skrip CLI `pnpm --filter gateway owner:init` untuk membuat akun pemilik (password argon2id) dan menampilkan QR/secret TOTP.
2. POST /auth/login (password + TOTP + info perangkat), POST /auth/refresh dengan rotasi dan deteksi pemakaian ulang, POST /auth/logout.
3. Access token JWT 15 menit dengan scope; refresh token acak 90 hari disimpan sebagai hash.
4. Middleware auth + pengecekan scope (app, worker, llm). Rate limit login.
5. GET /devices, DELETE /devices/:id, POST /devices/:id/push-token. Catat ke audit_log.
6. Tes: login sukses, TOTP salah, refresh berputar, token lama dipakai ulang mencabut perangkat.
Selesai jika: semua tes lulus dan alur bisa dicoba dengan curl.
```

### Fase 5 — Lapisan model (9Router)

```text
Dokumen: docs/ARCHITECTURE.md (Proxy model), VERIFICATION.md (9Router).
Tujuan: semua akses model lewat gateway.
Kerjakan:
1. Klien 9Router di gateway (OpenAI-compatible) dengan timeout, retry untuk error sementara, dan pencatatan usage per run.
2. GET /models: daftar model dan combo dari 9Router, di-cache 5 menit, dengan label yang ramah.
3. GET /quota: pemakaian dan kuota bila 9Router menyediakannya; bila tidak, ringkasan usage dari tabel runs.
4. Proxy /llm/v1/* ke 9Router, hanya untuk token ber-scope llm, mendukung streaming, tanpa meneruskan header Authorization asli.
5. Tes dengan mock server OpenAI-compatible.
Selesai jika: curl ke /llm/v1/chat/completions dengan token llm berhasil streaming lewat 9Router.
```

## Tahap B — Inti agent di server

### Fase 6 — Adapter Hermes, chat, dan WebSocket

```text
Dokumen: docs/ARCHITECTURE.md (Agent Adapter, Koneksi dan pemulihan), API_CONTRACT.md (Pesan, Run, WebSocket, AgentEvent), VERIFICATION.md (Hermes).
Tujuan: chat umum end-to-end dengan streaming yang tahan putus koneksi.
Kerjakan:
1. packages/adapters: antarmuka AgentAdapter dan RunHandle persis seperti di ARCHITECTURE.md, plus helper normalisasi event.
2. Adapter Hermes: HTTP streaming ke API server Hermes (127.0.0.1), mapping output Hermes ke AgentEvent, dukung cancel, simpan hermes_session_id per percakapan sesuai temuan VERIFICATION.md.
3. Modul percakapan dan pesan: CRUD percakapan, POST /conversations/:id/messages membuat pesan + run, menjalankan adapter, dan mengembalikan runId segera.
4. Event store: setiap AgentEvent disimpan di run_events dengan seq bertambah, lalu disiarkan.
5. WebSocket /v1/ws: auth token, subscribe channel dengan lastSeq dan replay dari DB, heartbeat 20 detik, batas channel per koneksi.
6. Judul percakapan otomatis dari pesan pertama (model kecil, maks 6 kata).
7. Tes: adapter dengan mock Hermes, replay setelah reconnect, cancel di tengah stream.
Sementara role selalu "general" (router dibuat di Fase 8).
Selesai jika: dengan wscat, pesan terkirim, jawaban mengalir, koneksi diputus lalu disambung ulang tanpa kehilangan event.
```

### Fase 7 — Registri role dan skill

```text
Dokumen: docs/ROLES_AND_SKILLS.md.
Tujuan: role dan skill sebagai file yang dimuat gateway dan disuntik ke mesin.
Kerjakan:
1. packages/roles/roles/*.md untuk 7 role awal (general, researcher, writer, frontend, backend, debugger, reviewer) dengan frontmatter lengkap sesuai format, termasuk 5+ contoh dan 2+ non-contoh.
2. packages/roles/skills/<id>/SKILL.md untuk 5 skill inti dan semua skill khusus yang dirujuk role. Tulis isinya sendiri sebagai checklist ringkas yang bisa diperiksa, berdasarkan tabel di dokumen. Untuk skill UI, ringkas prinsip dari skill ui-skills.com yang disebut di DESIGN_SYSTEM.md (jangan menyalin teks mereka utuh).
3. Loader di gateway: parse dan validasi frontmatter dengan Zod, gagal saat start bila role merujuk skill yang tidak ada, hot-reload saat file berubah di mode dev.
4. Builder bundel: untuk role tertentu, hasilkan system prompt = aturan perilaku agent + isi role + skill inti + skill khusus, dalam anggaran token di dokumen.
5. GET /roles.
6. Adapter Hermes memakai bundel ini sebagai pesan sistem.
Selesai jika: tes memastikan setiap role valid dan bundel tiap role berada di bawah anggaran.
```

### Fase 8 — Router otomatis

```text
Dokumen: docs/ROLES_AND_SKILLS.md (Router otomatis).
Tujuan: setiap pesan otomatis diarahkan ke role yang tepat tanpa @role.
Kerjakan:
1. Modul router: aturan cepat (lanjutan, surface Android, project aktif, pilihan manual) lalu router AI via combo router-fast dengan suhu 0 dan output JSON tervalidasi; satu kali coba ulang jika JSON tidak valid; fallback general.
2. Ambang confidence 0,6; needs_split menghasilkan subtasks.
3. Event route.decided di awal setiap run. Simpan routing_decisions.
4. POST /messages/:id/reroute: simpan routing_corrections, jalankan ulang dengan role baru. 20 koreksi terbaru masuk prompt router.
5. POST /route/preview untuk uji tanpa menjalankan agent.
6. packages/roles/evals/routing.jsonl (minimal 10 kasus per role, termasuk ambigu dan lanjutan) dan perintah pnpm eval:routing yang mencetak akurasi per role dan gagal di bawah 90%.
7. Tes unit untuk semua aturan cepat.
Selesai jika: eval routing lulus dan chat memakai role yang dipilih router.
```

### Fase 9 — Research engine

```text
Dokumen: docs/PRD.md (A2), ARCHITECTURE.md (Alur utama: deep research), ROLES_AND_SKILLS.md (role researcher).
Tujuan: deep research yang berjalan di server dan menghasilkan laporan bersitasi.
Kerjakan:
1. Job research dengan pg-boss: rencana (3–7 sub-pertanyaan, ditampilkan sebagai research.progress), pencarian lewat SearXNG JSON, pemilihan sumber (buang duplikat dan domain berkualitas rendah), pengambilan halaman dengan ekstraksi teks bersih (Readability), Playwright hanya bila halaman butuh JavaScript.
2. Ringkas per sumber, lalu sintesis laporan Markdown: ringkasan di atas, bagian per sub-pertanyaan, rujukan [n] di setiap paragraf faktual, daftar sumber dengan judul, URL, tanggal akses.
3. Kedalaman: cepat (sekitar 5 sumber), standar (sekitar 12), mendalam (sekitar 25). Batasi paralelisme dan total waktu.
4. Simpan research_jobs dan research_sources. Event research.progress dan research.source.
5. Endpoint: POST /research, GET /research, GET /research/:id, POST /research/:id/cancel, GET /research/:id/export (md dan pdf).
6. Notifikasi research.completed di channel user.
7. Tes dengan SearXNG dan halaman palsu.
Selesai jika: satu pertanyaan nyata menghasilkan laporan dengan sumber yang bisa diklik dan setiap klaim penting terhubung ke sumber.
```

### Fase 10 — Scheduler dan notifikasi push

```text
Dokumen: docs/PRD.md (Alur pengguna utama: jadwal), API_CONTRACT.md (Jadwal), SECURITY_OPS.md.
Tujuan: jadwal berjalan andal di VPS dan hasilnya sampai ke HP.
Kerjakan:
1. pg-boss untuk cron dengan zona waktu (default Asia/Jakarta). Target: chat (Hermes dengan role tertentu), research, atau role lain.
2. POST /schedules/parse: teks bahasa alami ke { name, cron, timezone, prompt, target, agent_role } via model kecil, dengan penjelasan jadwal yang dibaca manusia ("Setiap Senin 07.00 WIB") dan 3 waktu jalan berikutnya. Tidak menyimpan sebelum dikonfirmasi.
3. CRUD jadwal, run-now, riwayat schedule_runs. Hasil tiap run disimpan sebagai pesan di percakapan khusus jadwal itu.
4. Push FCM HTTP v1 untuk schedule.result dan research.completed ke perangkat Android dengan push_token. Payload hanya judul dan ID, isi diambil aplikasi setelah dibuka.
5. Mencegah dobel jalan (singleton per schedule) dan mencatat jadwal yang terlewat saat server mati.
6. Tes parser dengan 15 kalimat contoh.
Selesai jika: jadwal "setiap 5 menit" berjalan, hasil tersimpan, dan notifikasi uji sampai ke HP.
```

## Tahap C — Aplikasi Android

### Fase 11 — Scaffold Android, tema, dan login

```text
Dokumen: docs/DESIGN_SYSTEM.md (seluruhnya, terutama Layout Android dan larangan anti AI slop), CODING_STANDARDS.md (Android), API_CONTRACT.md (Auth).
Tujuan: kerangka aplikasi Android yang rapi sejak awal.
Kerjakan:
1. apps/android: Kotlin, Jetpack Compose, Material 3, Hilt, OkHttp, Retrofit, kotlinx.serialization, Room, DataStore terenkripsi. minSdk 26, targetSdk terbaru yang stabil.
2. Tema dari Tokens.kt (Fase 2): skema warna terang dan gelap, tipografi IBM Plex (font dibundel), bentuk 8/12/16 dp. Matikan dynamic color secara default.
3. Klien API dari openapi.json atau model tulisan tangan yang cocok dengan contracts. Interceptor auth dengan refresh token otomatis dan antrean request saat refresh.
4. Layar login: URL server, password, TOTP. Satu layar, tanpa langkah tambahan. Token tersimpan aman.
5. Kerangka navigasi: bottom nav Chat, Riset, Jadwal; ikon Pengaturan di top bar (berisi info perangkat, logout, tema).
6. Komponen dasar sesuai DESIGN_SYSTEM.md: tombol, field, chip, list item, skeleton, empty state, error banner, snackbar.
7. Halaman katalog komponen tersembunyi (debug build) untuk review visual.
Selesai jika: login ke server nyata berhasil, tema terang dan gelap konsisten, ./gradlew check lulus.
```

### Fase 12 — Chat Android

```text
Dokumen: docs/PRD.md (A1), DESIGN_SYSTEM.md (Komponen inti), API_CONTRACT.md (Pesan, WebSocket, AgentEvent).
Tujuan: pengalaman chat yang cepat, stabil, dan nyaman di HP.
Kerjakan:
1. Daftar percakapan di drawer: cari, sematkan, arsipkan, hapus.
2. Layar chat: pesan asisten tanpa gelembung, pesan pengguna blok surface-2, Markdown dan blok kode dengan tombol salin, langkah tool sebagai baris yang bisa dibuka.
3. Streaming via WebSocket dengan reconnect otomatis (backoff 1–30 detik) dan replay lastSeq. Indikator kecil saat menyambung ulang, tanpa dialog.
4. Chip role di atas jawaban: ketuk untuk memilih role lain, lalu panggil reroute.
5. Pemilih model di composer (dari /models), default otomatis sesuai role.
6. Lampiran gambar dan file (unggah ke /files), tombol hentikan saat streaming, edit dan kirim ulang pesan terakhir.
7. Cache Room untuk percakapan dan pesan agar terbuka instan dan terbaca offline.
8. Tes ViewModel untuk alur streaming dan reconnect.
Selesai jika: chat panjang tetap mulus di HP kelas menengah, putus jaringan lalu tersambung lagi tanpa pesan hilang.
```

### Fase 13 — Riset Android

```text
Dokumen: docs/PRD.md (A2, A7), API_CONTRACT.md (Riset, research.progress, research.source).
Tujuan: memulai dan membaca riset dari HP.
Kerjakan:
1. Tab Riset: daftar job (status, waktu, jumlah sumber) dan tombol riset baru.
2. Form riset: pertanyaan + pilihan kedalaman (cepat, standar, mendalam). Tampilkan rencana sub-pertanyaan begitu tersedia.
3. Layar progres: tahap berjalan dan sumber yang masuk secara live; tetap berjalan saat aplikasi ditutup.
4. Layar laporan: Markdown yang nyaman dibaca, rujukan [n] bisa diketuk untuk membuka sumber, daftar sumber di bawah.
5. Ekspor dan bagikan: Markdown dan PDF lewat share sheet Android.
6. Tombol "Lanjutkan di chat" yang membuat percakapan baru dengan laporan sebagai konteks.
Selesai jika: riset dimulai, aplikasi ditutup, notifikasi masuk (setelah Fase 14), laporan terbuka dengan sumber yang bisa diketuk.
```

### Fase 14 — Jadwal, notifikasi, share, dan suara

```text
Dokumen: docs/PRD.md (A3–A6), API_CONTRACT.md (Jadwal, Perangkat).
Tujuan: melengkapi fitur Android.
Kerjakan:
1. Tab Jadwal: daftar dengan toggle aktif, waktu jalan berikutnya, hasil terakhir. Buat jadwal dengan teks bahasa alami, tampilkan hasil parse (jadwal yang dibaca manusia, 3 waktu berikutnya, prompt, target) untuk dikonfirmasi atau diedit. Riwayat run per jadwal.
2. FCM: daftarkan push_token, kanal notifikasi terpisah (Riset, Jadwal), ketuk notifikasi membuka layar yang tepat. Minta izin notifikasi Android 13+ dengan penjelasan satu kalimat.
3. Share intent: teks atau URL dari aplikasi lain membuka chat baru dengan isian terisi, belum terkirim.
4. Input suara: tahan tombol mikrofon, transkripsi (SpeechRecognizer Android, atau endpoint STT 9Router jika tersedia), teks bisa diedit sebelum dikirim.
Selesai jika: keempat fitur bekerja di perangkat nyata dan ./gradlew check lulus.
```

## Tahap D — Aplikasi Windows

### Fase 15 — Scaffold desktop, shell, dan login

```text
Dokumen: docs/DESIGN_SYSTEM.md (seluruhnya, terutama Layout Windows), CODING_STANDARDS.md (Desktop), SECURITY_OPS.md (token).
Tujuan: aplikasi Tauri 2 dengan kerangka layout final.
Kerjakan:
1. apps/desktop: Tauri 2 + React 19 + Vite + TypeScript + Tailwind CSS v4 + TanStack Router + TanStack Query + Radix. Impor tokens.css. Font IBM Plex dibundel.
2. Shell: rail kiri 56px, sidebar 260px yang bisa diciutkan, area utama, panel kanan bertab yang lebarnya bisa diubah dan diingat, status bar 24px.
3. Login satu layar (URL server, password, TOTP). Token disimpan di Windows Credential Manager lewat plugin Tauri. Setelah login pertama, aplikasi masuk otomatis dan memperbarui token sendiri. Tidak ada langkah "Hubungkan" terpisah.
4. Klien WebSocket bersama dengan reconnect otomatis, replay lastSeq, dan deteksi bangun dari sleep atau idle lama (event visibilitychange dan resume jaringan) yang langsung menyambung ulang.
5. Tema terang, gelap, ikut sistem. Shortcut dasar: Ctrl+K (palette kosong dulu), Ctrl+N chat baru, Ctrl+B sidebar, Ctrl+J panel kanan.
6. Halaman katalog komponen (mode dev) berisi semua komponen dasar dan state-nya.
Selesai jika: login sekali, tutup dan buka lagi langsung masuk; tinggalkan PC tidur 1 jam lalu buka, status tersambung kembali sendiri dalam 10 detik.
```

### Fase 16 — Chat umum, riset, dan jadwal di desktop

```text
Dokumen: docs/PRD.md (W1, W10), DESIGN_SYSTEM.md (Komponen inti), API_CONTRACT.md.
Tujuan: fitur non-coding desktop setara Android, dengan kepadatan desktop.
Kerjakan:
1. Chat umum: daftar percakapan di sidebar, pesan dan langkah tool sesuai komponen inti, chip role yang bisa diganti, pemilih model, lampiran drag-and-drop, stop, edit pesan terakhir.
2. Riset: daftar, form, progres live, laporan dengan rujukan yang bisa diklik, ekspor.
3. Jadwal: tabel jadwal, buat dengan bahasa alami plus konfirmasi hasil parse, riwayat run.
4. Semua state memuat, kosong, error, offline didesain.
Selesai jika: alur chat, riset, dan jadwal berjalan dengan data yang sama seperti di Android.
```

## Tahap E — Coding agent di Windows

### Fase 17 — Worker sidecar dan project

```text
Dokumen: docs/ARCHITECTURE.md (Worker, Koneksi dan pemulihan), API_CONTRACT.md (Protokol worker, Project), SECURITY_OPS.md (Worker dan eksekusi).
Tujuan: proses lokal yang aman untuk menjalankan agent di folder project.
Kerjakan:
1. apps/worker: TypeScript, dikompilasi Bun menjadi satu .exe, dijalankan sebagai sidecar Tauri. Dimulai dan dimatikan bersama aplikasi.
2. Server WebSocket lokal di 127.0.0.1 port acak, token sekali pakai dari Tauri. Koneksi WSS keluar ke gateway dengan token scope worker (didaftarkan otomatis saat login desktop).
3. Daftar folder yang diizinkan, dikelola dari Pengaturan desktop. Semua path dinormalisasi dan dicek.
4. Registrasi project: pilih folder lewat dialog, deteksi stack (package.json, pyproject, build.gradle, Cargo.toml, dan lain-lain), deteksi git dan default branch, simpan ke /projects.
5. Status worker di status bar: tersambung, menyambung ulang, mati. Reconnect otomatis.
6. Pengelola proses anak: lacak, batasi, matikan saat run selesai atau aplikasi keluar.
7. Tes: penolakan path di luar folder yang diizinkan, termasuk symlink dan ../.
Selesai jika: project bisa didaftarkan dan worker tetap tersambung setelah jaringan putus-sambung.
```

### Fase 18 — Adapter omp, chat project, worktree, dan approval

```text
Dokumen: docs/ARCHITECTURE.md (Agent Adapter, Alur utama: run coding), VERIFICATION.md (omp), ROLES_AND_SKILLS.md, SECURITY_OPS.md.
Tujuan: chat per folder project yang dikerjakan omp dengan aman.
Kerjakan:
1. Adapter omp di packages/adapters: menjalankan omp --mode rpc dengan cwd = worktree, provider diarahkan ke /llm/v1 gateway dengan token llm, mapping event RPC ke AgentEvent, steer, cancel.
2. Penyuntikan role dan skill sesuai metode di VERIFICATION.md, tanpa menulis file ke worktree. Fallback: pesan sistem pertama.
3. Worktree per run: git worktree add ke folder .aios-worktrees di luar repo kerja, branch aios/<runId-pendek>, dibersihkan setelah diterima atau ditolak.
4. Approval: event approval.requested tampil sebagai panel inline (perintah persis, cwd), tombol Izinkan sekali, Selalu untuk project ini (simpan pola), Tolak. Tanpa jawaban, run menunggu.
5. UI chat project: pilih project di sidebar, percakapan terikat project, status bar menampilkan project dan branch.
6. Tes adapter dengan proses omp palsu yang memutar ulang transkrip RPC nyata dari VERIFICATION.md.
Selesai jika: tugas "tambahkan tes untuk fungsi X" di project nyata berjalan di worktree, meminta izin menjalankan tes, dan branch kerja asli tidak berubah.
```

### Fase 19 — Review diff dan checkpoint

```text
Dokumen: docs/PRD.md (W4, W12), DESIGN_SYSTEM.md (Komponen inti: Diff).
Tujuan: hasil agent ditinjau seperti code review, lalu diterima atau dikembalikan.
Kerjakan:
1. Worker menghitung diff worktree terhadap base, mengirim diff.updated (daftar file, tambah, hapus) dan menyajikan isi diff lewat IPC lokal.
2. Panel Diff: daftar file, tampilan unified dan split, syntax highlight, komentar per baris.
3. Kirim komentar ke agent: komentar dibundel jadi satu pesan steer berisi path, baris, dan isi komentar.
4. Terima: commit di branch run dengan pesan Conventional Commits yang dibuat agent, lalu pilihan merge ke branch kerja atau biarkan sebagai branch. Tolak: buang worktree.
5. Checkpoint: commit sementara setelah setiap langkah agent yang mengubah file; undo ke checkpoint mana pun dari daftar.
Selesai jika: komentar di satu baris membuat agent memperbaiki tepat bagian itu, lalu diff diterima dan commit tercipta.
```

### Fase 20 — Kanban AI

```text
Dokumen: docs/PRD.md (W6), API_CONTRACT.md (Kanban), DESIGN_SYSTEM.md (Komponen inti: Kartu kanban).
Tujuan: tugas project dikelola sebagai kartu yang bisa dikerjakan AI.
Kerjakan:
1. Papan per project: kolom Backlog, Todo, Running, Review, Done dengan jumlah kartu. Drag-and-drop dengan keyboard alternatif.
2. Kartu: judul, deskripsi Markdown, chip role (diisi router, bisa diganti), titik status, branch, diff stat.
3. Tombol "Kerjakan dengan AI": membuat run coding dari kartu, kartu pindah ke Running lalu otomatis ke Review saat run selesai. Klik kartu di Review membuka panel Diff.
4. "Pecah dengan AI": tulis ide, AI mengusulkan beberapa kartu dengan role masing-masing; pengguna memilih yang disimpan.
5. Batas run paralel per project (default 2), dengan antrean.
6. Perubahan kartu tersinkron real-time lewat channel user.
Selesai jika: dua kartu dikerjakan paralel di worktree berbeda tanpa saling mengganggu.
```

### Fase 21 — Preview website dan testing

```text
Dokumen: docs/PRD.md (W7–W9), ARCHITECTURE.md (Komponen: Worker sidecar).
Tujuan: melihat dan menguji hasil kerja agent langsung di aplikasi.
Kerjakan:
1. Worker mendeteksi perintah dev server dari stack (misalnya script dev di package.json), menjalankannya di worktree run atau folder project, mencari port, mengirim preview.ready.
2. Tab Preview di panel kanan: WebView ke URL itu, reload, buka di browser, pilihan ukuran (ponsel 390, tablet 768, desktop penuh), log console dan error di bawahnya.
3. Tool untuk agent lewat worker (Playwright Chromium): screenshot halaman, klik dan isi elemen dengan selector, baca error console dan request gagal. Tool ini dipanggil omp lewat MCP lokal atau skrip yang disediakan worker, sesuai VERIFICATION.md.
4. Pilih elemen: mode inspeksi di Preview, klik elemen, lalu outerHTML, selector, style terhitung penting, dan screenshot area masuk ke composer sebagai lampiran.
5. Hentikan dev server saat run selesai atau tab ditutup.
Selesai jika: agent bisa diminta "perbaiki tombol yang terpotong di layar ponsel", mengambil screenshot sendiri, memperbaiki, lalu memverifikasi dengan screenshot kedua.
```

### Fase 22 — Terminal, palette, dan pelengkap

```text
Dokumen: docs/PRD.md (W11, W13–W15), DESIGN_SYSTEM.md.
Tujuan: alat bantu kerja harian.
Kerjakan:
1. Tab Terminal: xterm.js ke PTY di worker, satu terminal per project, cwd di folder project atau worktree run.
2. Command palette Ctrl+K: cari percakapan, project, kartu, jadwal; aksi (chat baru, riset baru, pindah project, ganti model, ganti tema). Navigasi penuh dengan keyboard.
3. Status bar lengkap: project dan branch, role aktif, model, status worker, kuota ringkas.
4. Pembanding model: satu prompt ke 2–3 model berdampingan, dengan waktu dan usage.
5. Halaman Kuota: pemakaian per model dan per hari dari /quota.
Selesai jika: seluruh aplikasi bisa dipakai hanya dengan keyboard untuk alur utama.
```

## Tahap F — Hardening dan rilis

### Fase 23 — Keamanan, backup, dan observability

```text
Dokumen: docs/SECURITY_OPS.md (seluruhnya), VPS_SETUP.md.
Tujuan: sistem siap dipakai harian tanpa khawatir.
Kerjakan:
1. Audit keamanan: cek setiap endpoint punya auth dan scope yang benar, rate limit aktif, log bebas rahasia, worker menolak path dan perintah sesuai aturan. Tulis temuan dan perbaikannya.
2. infra/scripts: backup.sh (pg_dump + restic ke Oracle Object Storage + data Hermes), restore.sh ke database sementara, unit dan timer systemd harian.
3. Uptime Kuma (compose opsional) memantau /readyz, notifikasi Telegram.
4. Halaman Status di desktop: versi gateway, worker, adapter, status dependensi, antrean job.
5. infra/VERSIONS.md diperbarui; skrip cek versi tools di VPS.
6. Tes beban ringan: 5 run bersamaan + 1 riset mendalam, catat memori dan CPU VPS.
Selesai jika: restore uji berhasil dan audit tidak menyisakan temuan tinggi.
```

### Fase 24 — E2E, review desain, dan rilis

```text
Dokumen: docs/ACCEPTANCE.md, DESIGN_SYSTEM.md.
Tujuan: versi 1.0 yang stabil dan rapi.
Kerjakan:
1. E2E Playwright untuk desktop: login, chat streaming, run coding sampai review dan terima, kanban, riset, jadwal. E2E Android dengan Compose UI test untuk login, chat, riset.
2. Review desain menyeluruh memakai checklist DESIGN_SYSTEM.md dan skill review UI (rams atau better-interface): spasi, tipografi, kontras, fokus, state kosong dan error, konsistensi Windows dan Android. Perbaiki semua temuan tinggi dan sedang.
3. Pengemasan: installer Windows (NSIS atau MSI dari Tauri) dengan worker dan omp sidecar, auto-update Tauri ke rilis GitHub privat; APK Android release bertanda tangan.
4. Deploy gateway lewat skrip infra/scripts/deploy.sh (build image arm64, migrate, restart, cek /readyz, rollback bila gagal).
5. CHANGELOG.md dan tag v1.0.0.
Selesai jika: semua item di ACCEPTANCE.md tercentang.
```
