# API & Event Contract — Personal AI OS

Semua klien memakai satu REST API `/v1` dan satu WebSocket `/v1/ws`. Skema didefinisikan sekali di `packages/contracts` (Zod) lalu dipakai gateway, desktop, worker, dan menjadi OpenAPI untuk Android.

## Konvensi

- ID memakai UUIDv7. Waktu disimpan UTC (`timestamptz`), zona waktu jadwal default `Asia/Jakarta`.
- Error memakai format RFC 9457: `{ type, title, status, detail, code }`.
- Pagination berbasis kursor: `?before=<id>&limit=50`.
- Auth: header `Authorization: Bearer <access_token>`. Access token 15 menit, refresh token per perangkat 90 hari, bisa dicabut.

## Endpoint REST

| Area        | Endpoint                                                                          | Fungsi                                                                                                                                                                                                                                                                                                                                                                    |
| ----------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth        | `POST /auth/login`                                                                | Password + TOTP, mendaftarkan perangkat, mengembalikan token                                                                                                                                                                                                                                                                                                              |
| Auth        | `POST /auth/refresh`, `POST /auth/logout`                                         | Perbarui atau cabut token perangkat                                                                                                                                                                                                                                                                                                                                       |
| Perangkat   | `GET /devices`, `DELETE /devices/:id`, `POST /devices/:id/push-token`             | Kelola perangkat dan token FCM                                                                                                                                                                                                                                                                                                                                            |
| Perangkat   | `POST /devices/worker`                                                            | Desktop mendaftarkan worker sidecar (scope `app`); mengembalikan perangkat `worker` dan tokennya, worker lama bernama sama dicabut                                                                                                                                                                                                                                        |
| Model       | `GET /models`, `GET /quota`                                                       | Daftar model dan combo dari 9Router, pemakaian dan kuota                                                                                                                                                                                                                                                                                                                  |
| Agent       | `GET /roles` | Daftar agent tetap (umum, project, peneliti) beserta model dan skill bawaannya; agent dipilih server dari ada tidaknya project, bukan dari klien |
| Percakapan | `GET/POST /conversations`, `GET/PATCH/DELETE /conversations/:id` | Daftar, buat, ubah judul, arsipkan. `DELETE ?permanent=true` menghapus percakapan beserta pesannya (`409 run_in_progress` bila jawaban masih berjalan) |
| Pesan       | `GET /conversations/:id/messages`, `POST /conversations/:id/messages`             | Riwayat; kirim pesan sekaligus memulai run Opsional `planOnly: true`: run coding mode rencana (agent hanya membaca dan menulis rencana; worker menolak semua izin; run selesai `completed` tanpa tinjauan diff). `Run.planOnly` menandainya. Opsional `webSearch: true`: gateway membuat kueri (model kecil, dari pesan dan percakapan), mencari lewat SearXNG, membaca halaman teratas, dan menempelkan hasil bernomor (maks. 5 hasil, 3 halaman dibaca, 5.000 karakter per halaman) ke prompt agent; berlaku untuk chat umum dan project; gagal mencari tidak menggagalkan pesan. Opsional `skills[]` (tambah) dan `skillsOff[]` (cabut): skill spesialis untuk pesan ini; tanpa keduanya server memilih paket skill dari kata kunci pesan (frontend, backend, debugging, review, riset, menulis), tanpa memanggil model. Agent ditentukan server: agent project (worker, omp) untuk chat per folder project di Windows, selain itu agent umum (server, Hermes). Run coding membawa riwayat percakapan ke worker (`run.start.history`, maks. 40 giliran) dan berstatus `completed` bila tidak ada perubahan berkas (hanya yang berubah masuk `needs_review`) |
| Pesan       | `POST /messages/:id/edit`, `DELETE /messages/:id`                                 | Potong percakapan dari pesan itu (pesan itu dan semua sesudahnya dibuang). `edit` (hanya pesan pengguna) lalu mengirim teks baru seperti `POST /conversations/:id/messages`. Sesi Hermes diganti; giliran berikutnya mengirim riwayat yang tersisa sebagai konteks, sehingga agent tidak mengingat bagian yang dibuang. `409 run_in_progress` bila jawaban masih berjalan |
| Pesan | `POST /messages/:id/fork` | Cabang percakapan: `201` percakapan baru (project dan ruang sama, judul "Cabang: …") berisi salinan pesan dari awal sampai pesan ini (maks 500; run tidak ikut disalin). Agent di cabang memulai sesi baru dengan salinan itu sebagai riwayat awal. Asal tidak berubah. `409 message_not_forkable` (pesan sistem), `run_active` (jawaban masih berjalan), `fork_too_long` |
| Run | `POST /fleets` | Armada agent: `{ projectId, tasks[{prompt}] (1–4), planOnly?, model? }` → `201 { items[{conversationId, title, run}], failed }`. Tiap tugas menjadi percakapan sendiri (judul dari baris pertama prompt) dan run coding sendiri di worktree sendiri; role dipilih router seperti chat project biasa. Jumlah run yang belum selesai (tidak termasuk `needs_review`) per project dibatasi 4 termasuk dari kartu kanban dan chat biasa: `409 fleet_busy` bila melebihi. Tugas yang gagal dimulai dihitung di `failed` (yang lain tetap berjalan); `502 fleet_failed` bila tidak satu pun berhasil. `404 project_not_found` |
| Run | `GET /runs?kind=&limit=`, `GET /runs/:id`, `GET /runs/:id/events?afterSeq=` | Daftar run terbaru (default `kind=coding`, maks 100) dengan judul kartu atau percakapan dan nama project untuk Ruang Kerja; status dan putar ulang event |
| Run         | `POST /runs/:id/steer`, `POST /runs/:id/cancel`                                   | Arahkan atau hentikan agent                                                                                                                                                                                                                                                                                                                                               |
| Run         | `POST /runs/:id/approvals/:approvalId`                                            | `{ decision: allow \| deny, remember }`                                                                                                                                                                                                                                                                                                                                   |
| Run         | `POST /runs/:id/review`                                                           | `{ decision: accept \| reject, comments[], merge?, commitMessage? }`; hasil `{ run, branch, commit, merged, mergeSkipped, revisionRunId }`. `accept` = satu commit di branch `aios/…` (opsional fast-forward ke branch kerja); `reject` = buang; `reject` dengan `comments` = run baru di worktree yang sama (`revisionRunId`)                                            |
| Project     | `GET/POST /projects`, `PATCH/DELETE /projects/:id`                                       | Project terdaftar per worker (path tetap lokal). `instructions` (maks 4000 karakter) adalah aturan project yang disuntik ke pesan sistem setiap run di project itu                                                                                                                                                                                                                                                                                                                          . `DELETE` menghapus project dan kartu kanbannya; percakapannya menjadi chat biasa dan folder di PC tidak disentuh (`409 project_busy` bila masih ada run berjalan) |
| Kanban      | `GET /projects/:id/tasks`, `POST /tasks`, `PATCH /tasks/:id`                      | Kartu, status, urutan, role. `PATCH` dengan `status`/`position` memindahkan kartu; urutan kedua kolom dirapikan server. Hanya Backlog, Todo, dan Done yang bisa dituju; Running dan Review diisi sistem                                                                                                                                                                   |
| Kanban      | `POST /tasks/:id/run`, `POST /tasks/breakdown`                                    | Kerjakan kartu (run coding; mengembalikan kartu: `runId` terisi bila dimulai, `null` bila mengantre karena slot project penuh); AI memecah ide jadi usulan kartu (belum disimpan)                                                                                                                                                                                         |
| Jadwal | `GET/POST /schedules`, `PATCH/DELETE /schedules/:id` | Kelola jadwal. Target `briefing` merangkum riset selesai, kartu di Review, dan hasil jadwal lain dalam 24 jam terakhir ditambah topik di prompt. `notify: on_change` (bukan untuk `research`) mengirim hasil run sebelumnya sebagai konteks; bila agent menyatakan tidak ada perubahan, run tetap `succeeded` dengan `changed: false` dan tanpa push |
| Jadwal      | `POST /schedules/parse`, `POST /schedules/:id/run-now`, `GET /schedules/:id/runs` | Bahasa alami ke cron, jalankan sekarang, riwayat                                                                                                                                                                                                                                                                                                                          |
| Riset       | `POST /research`, `GET /research`, `GET /research/:id`                            | Buat dan pantau job riset                                                                                                                                                                                                                                                                                                                                                 |
| Riset       | `POST /research/:id/cancel`, `GET /research/:id/export?format=md\|pdf`            | Batalkan, ekspor                                                                                                                                                                                                                                                                                                                                                          |
| Berkas | `POST /files`, `GET /files/:id/download` | Unggah lampiran (maks 25 MB); unduh berkas sebagai attachment. Berkas buatan agent di server (folder kiriman `OUTBOX_DIR`, per run) ditempel ke jawaban sebagai bagian `file` saat run chat selesai (maks 10 berkas, 25 MB per berkas, 50 MB total; symlink dan path di luar folder run diabaikan) |
| Memori      | `GET/POST /memories`, `PATCH/DELETE /memories/:id`                                | Fakta tentang pemilik (maks 500 karakter, maks 200 memori; `409 memory_limit` bila penuh). Memori aktif disuntik ke pesan sistem setiap run chat dan coding, terlama dulu; yang nonaktif tetap tersimpan                                                                                                                                                                  |
| Templat | `GET/POST /prompt-templates`, `PATCH/DELETE /prompt-templates/:id` | Prompt tersimpan yang dipanggil dengan `/nama` di kolom pesan (nama huruf kecil, angka, strip, maks 40 karakter dan unik; isi maks 4000 karakter; maks 100 templat; `409 template_name_taken` dan `template_limit`). `{{parameter}}` di isi diisi klien saat dipakai; gateway tidak memprosesnya |
| Ruang | `GET/POST /spaces`, `PATCH/DELETE /spaces/:id`, `GET/POST /spaces/:id/documents`, `DELETE /spaces/:id/documents/:documentId` | Ruang pengetahuan: berkas dari `POST /files` (PDF, DOCX, teks) diekstrak, dipotong per bagian, dan diindeks full-text. Percakapan dengan `spaceId` (`POST /conversations`) menyertakan potongan paling relevan sebagai konteks tiap giliran dan agent menyebut sumbernya. `GET /conversations?spaceId=` menyaring percakapan ruang. Maks 50 dokumen per ruang (`409 space_full`) |
| Pencarian | `GET /search?q=&limit=` | Cari di semua pesan chat (percakapan tidak diarsipkan) dan laporan riset dengan full-text search; semua kata kunci harus ada (pencocokan awalan). Hasil `{ kind: message \| research, ..., snippet }`, paling relevan dulu |
| Model       | `POST /compare`                                                                   | `{ prompt, models[2..3] }` → `{ results[{ model, ok, text, latencyMs, usage, error }] }`; paralel lewat 9Router tanpa streaming, satu model gagal tidak menggagalkan yang lain, tidak membuat percakapan atau run                                                                                                                                                         |
| Percakapan | `POST /conversations/:id/handoff` | Lanjut dengan ringkasan: `{ model }` → `201` percakapan baru (project dan ruang sama, judul "Lanjutan: …") yang diawali satu pesan sistem "Ringkasan percakapan sebelumnya …". Satu panggilan model lewat 9Router atas maks 60 pesan terbaru (tiap pesan dipotong 4.000 karakter, total 40.000). Pesan pertama di percakapan baru membawa ringkasan itu ke agent sebagai riwayat awal. Percakapan lama tidak berubah. `409 conversation_empty`, `502 handoff_failed` |
| Model | `POST /review/opinion` | Pendapat kedua: `{ model, files[{path, patch}] }` → `{ model, summary, findings[{path, line, severity, body}], truncated }`. Satu panggilan model lewat 9Router tanpa menyimpan apa pun; diff dikirim desktop hanya saat pemilik menekan tombolnya, dipotong di 60.000 karakter, temuan di luar berkas yang dikirim dibuang, maks 10 temuan. `502 opinion_failed` bila model gagal |
| Proxy model | `/llm/v1/*`                                                                       | Diteruskan ke 9Router, hanya token ber-scope `llm`                                                                                                                                                                                                                                                                                                                        |
| Kesehatan   | `GET /healthz`, `GET /readyz`                                                     | Cek layanan dan dependensi (tanpa auth, untuk pemantau)                                                                                                                                                                                                                                                                                                                   |
| Kesehatan   | `GET /status`                                                                     | Halaman Status (scope `app`): versi gateway dan adapter, dependensi, worker terdaftar dan statusnya, antrean job, run berjalan                                                                                                                                                                                                                                            |

## WebSocket

Klien membuka `/v1/ws`, lalu berlangganan channel: `user` (notifikasi umum), `conversation:<id>`, `run:<id>`. Saat berlangganan, klien mengirim `lastSeq` agar event yang terlewat diputar ulang.

```json
{ "type": "subscribe", "channel": "run:0192f0c4-...", "lastSeq": 41 }
```

Setiap event dari server dibungkus envelope yang sama:

```json
{
  "v": 1,
  "channel": "run:0192f0c4-...",
  "seq": 42,
  "ts": "2026-10-22T06:38:00Z",
  "event": { "type": "message.delta", "messageId": "...", "text": "..." }
}
```

## Tipe AgentEvent

| Event                                          | Isi                                                          | Dipakai untuk               |
| ---------------------------------------------- | ------------------------------------------------------------ | --------------------------- |
| `run.status`                                   | `status`                                                     | Indikator status            |
| `route.decided`                                | `role, confidence, reason`                                   | Agent dan skill yang dimuat |
| `message.delta`, `message.completed`           | Potongan teks; usage token                                   | Streaming jawaban           |
| `reasoning.delta`                              | Potongan penalaran (opsional)                                | Blok terlipat               |
| `tool.started`, `tool.output`, `tool.finished` | Nama, target, potongan output, status, durasi                | Baris langkah tool          |
| `approval.requested`, `approval.resolved`      | Jenis (command, file_write, network), detail, cwd; keputusan | Panel izin                  |
| `diff.updated`                                 | Daftar file dengan tambah dan hapus                          | Panel diff, diff stat kartu |
| `checkpoint.created`                           | ID dan label                                                 | Undo                        |
| `preview.ready`                                | URL dev server                                               | Panel preview               |
| `research.progress`, `research.source`         | Tahap dan progres; sumber baru                               | Layar riset                 |
| `error`                                        | `code, message, retryable`                                   | Pesan error                 |
| `run.completed`                                | Ringkasan, usage                                             | Penutup run                 |

Channel `user` membawa: `task.updated`, `schedule.result`, `research.completed`, `notification`.

## Kartu kanban

Kartu mengikuti run terbarunya: run berjalan = **Running**, `needs_review` = **Review**, `accepted` = **Done**, `failed`/`cancelled`/`rejected` = kembali ke **Todo** (kegagalan juga memicu `notification` level error). Tolak dengan komentar membuat run revisi, jadi kartu tetap Running. Kartu antre = status `running` dengan `runId` null; dimulai sendiri saat slot kosong (batas `TASK_MAX_PARALLEL`, default 2 per project). Kartu dengan run aktif tidak bisa dipindah (409 `task_running`); kartu antre boleh dikeluarkan. Setiap run kartu berjalan di worktree dan branch sendiri (`aios/<id>`), jadi run paralel tidak saling mengganggu.

## Protokol worker

- Worker membuka WebSocket ke gateway di `/v1/worker/ws` dengan token ber-scope `worker` (header `Authorization` saat handshake). Satu koneksi aktif per perangkat; koneksi baru menggantikan yang lama. Gateway hanya menerima `run.event` untuk run milik project yang terdaftar atas perangkat itu.
- Perintah dari gateway: `run.start` (runId, projectId, prompt, bundel role dan skill, model, `continueFromRunId` untuk revisi), `run.steer`, `run.cancel`, `approval.resolve`, `review.apply` (dijawab worker dengan frame `review.result`; gateway menunggu maksimal 30 detik, dan worker menjawab perintah yang diulang dengan hasil yang sama).
- Isi diff tidak lewat gateway: aplikasi desktop membacanya dari worker lokal (`review.get`, `review.undo`, `review.revertFile`); ke gateway hanya event `diff.updated` (daftar file, tambah, hapus) dan `checkpoint.created`.
- Terminal: shell sungguhan (PTY) di worker, satu per project atau per worktree run. Desktop memakai `terminal.open` (mengembalikan id dan riwayat keluaran), `terminal.write`, `terminal.resize`, `terminal.close`; worker mendorong `terminal.data` dan `terminal.exit`. Tidak lewat gateway.
- Berkas (hanya baca): `files.list` (isi folder, `path` relatif, kosong = akar; maks 500 entri), `files.read` (teks UTF-8 maks 512 KB, gambar base64 maks 5 MB, biner dan yang terlalu besar tidak dikirim isinya), `files.find` (quick-open, pencocokan longgar, maks 30 hasil). Target sama dengan terminal: folder project atau worktree run. Path diselesaikan lewat realpath dan harus tetap di dalam folder itu: path absolut, `..`, symlink keluar, `.git`, dan `node_modules` ditolak. Tidak lewat gateway.
- Git (hanya baca): `git.status` (branch, upstream, ahead/behind, berkas yang berubah dengan status modified/added/deleted/renamed/untracked/conflicted dan staged/unstaged; maks. 300 berkas; `isRepo: false` bila bukan repo), `git.diff` (unified diff satu berkas terhadap HEAD, berkas baru yang belum dilacak sebagai semua baris tambah, biner ditandai tanpa isi, dipotong di 256 KB), `git.log` (commit terbaru, maks. 50). Target sama dengan files.*. Perintah git berjalan dengan `GIT_OPTIONAL_LOCKS=0` (tidak menulis indeks), tanpa prompt kredensial, batas 10 detik; path absolut, `..`, dan awalan `-` ditolak. Tidak lewat gateway.
- Aksi git (mengubah repo; hanya folder project, bukan worktree run; tidak pernah force): `git.stage` / `git.unstage` (`paths[]` atau `all`), `git.discard` (membuang perubahan satu berkas, berkas baru yang belum dilacak dihapus; tidak bisa dibatalkan), `git.commit` (`message` wajib, harus ada yang di-stage; hook git ikut berjalan; hasilnya commit baru), `git.branches` (branch lokal), `git.checkout` (hanya ke branch lokal yang ada), `git.pull` (`--ff-only`), `git.push` (branch saat ini ke upstream; tanpa upstream ke `origin` dengan `-u`). Galat git dikembalikan sebagai `git_failed` dengan pesan git (kredensial di URL dibuang). Tanpa prompt kredensial (`GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=never`); batas 30 detik (aksi lambat 90 detik). Tidak lewat gateway.
- Preview website: desktop membaca dan mengendalikannya dari worker lokal (`preview.start`, `preview.get`, `preview.stop`, `preview.shot`; worker mendorong `preview.state`). Ke gateway hanya event `preview.ready` (URL proxy lokal) selama run berjalan. Agent memakai tool browser lewat server MCP lokal worker, bukan lewat gateway.
- Worker mengirim AgentEvent ke channel `run:<id>`. Gateway menyimpan lalu menyiarkan.
- Aplikasi desktop dan worker bicara lewat WebSocket lokal di `127.0.0.1` dengan port acak dan token yang diberikan Tauri saat sidecar dijalankan. Token dipakai sekali: balasan `ready` membawa token untuk koneksi berikutnya. Koneksi yang membawa header `Origin` (halaman web) ditolak. Skema pesan lokal ada di `packages/contracts/src/worker-local.ts`.

## Status run

```mermaid
stateDiagram-v2
  [*] --> queued
  queued --> routing
  routing --> preparing
  preparing --> running
  running --> waiting_approval
  waiting_approval --> running
  running --> needs_review: run coding
  needs_review --> accepted
  needs_review --> rejected
  running --> completed: run chat
  running --> failed
  running --> cancelled
```

`queued` → `routing` → `preparing` (buat worktree) → `running`, yang bisa bolak-balik ke `waiting_approval`. Run coding berakhir di `needs_review` lalu `accepted` atau `rejected`. Run chat berakhir di `completed`. Semua run bisa berakhir `failed` atau `cancelled`.

## Model data inti

| Tabel                 | Kolom penting                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `devices`             | id, kind (android, desktop, worker), name, token_hash, scopes, push_token, last_seen_at                                        |
| `conversations`       | id, title, surface, project_id, space_id, hermes_session_id, pinned, archived_at                                                         |
| `messages`            | id, conversation_id, author (user, assistant, system), parts (jsonb), agent_role, model, run_id                                |
| `runs`                | id, kind (chat, coding, research, schedule), engine, agent_role, model, status, conversation_id, task_id, branch, usage, error |
| `run_events`          | run_id, seq, type, payload (jsonb), ts — primary key (run_id, seq)                                                             |
| `approvals`           | id, run_id, kind, detail, status, remember, decided_at                                                                         |
| `approval_rules`      | project_id, pattern, decision                                                                                                  |
| `projects`            | id, name, worker_device_id, stack (jsonb), default_branch, instructions                                                                      |
| `tasks`               | id, project_id, title, body, status, position, agent_role, run_id, branch, diff_stat                                           |
| `schedules` | id, name, cron, timezone, prompt, target (chat, research, role, briefing), agent_role, enabled, notify (always, on_change), next_run_at |
| `schedule_runs` | id, schedule_id, run_id, status, started_at, finished_at, changed |
| `research_jobs`       | id, question, depth, status, plan (jsonb), report_md, run_id                                                                   |
| `research_sources`    | id, job_id, url, title, fetched_at, used                                                                                       |
| `files`               | id, name, mime, size, content (bytea, isi berkas; ikut backup), sha256                                                         |
| `routing_decisions`   | id, message_id, role, confidence, reason, latency_ms                                                                           |
| `audit_log`           | id, actor_device_id, action, target, ts                                                                                        |
| `memories`            | id, text, enabled, created_at, updated_at                                                                                      |
| `prompt_templates` | id, name (unik), body, created_at, updated_at |
| `spaces` | id, name, description, created_at, updated_at |
| `space_documents` | id, space_id, file_id, name, chars, created_at |
| `space_chunks` | id, document_id, space_id, ordinal, content, tsv (tsvector `simple`, indeks GIN) |
