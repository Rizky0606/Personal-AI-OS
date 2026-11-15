# Desain — Memori semantik

Status: **desain, belum ada kode fitur.** Dokumen ini hasil investigasi di branch `feat/memori-semantik` (dasar `main` @ `df30e68`), 15 November 2026. Semua rujukan `berkas:baris` mengacu ke commit itu. Yang diukur ditulis sebagai angka; yang tidak diukur ditandai **[tidak diukur]** atau **[dugaan]**.

Tujuan:

1. **Recall per pesan**: hanya memori yang relevan dengan pesan yang masuk ke pesan sistem, bukan semua memori aktif.
2. **Ekstraksi otomatis**: fakta awet tentang pemilik diambil dari giliran percakapan, sebagai usulan atau simpan otomatis dengan asal-usul yang terlihat dan mudah diurungkan.
3. **Retrieval hibrida** (leksikal + vektor) yang bisa dipakai ulang oleh ruang pengetahuan.

Ringkasan keputusan:

| Hal | Keputusan |
| --- | --- |
| Penyimpanan vektor | Kolom `bytea` (Float32) di tabel biasa, skor kosinus dihitung di gateway. Tanpa pgvector. |
| Embedding | **Saat ini tidak ada model embedding yang berfungsi lewat 9Router** (lihat bagian 2). Desain berjalan tanpa embedding (leksikal) dan menyalakan vektor hanya bila `EMBEDDING_MODEL` diisi. |
| Slice 1 | Recall beranggaran + memori tersemat, leksikal saja. Tanpa perubahan infra, tanpa panggilan model. |
| Ekstraksi | Mode `off` (bawaan kode), `propose` (disarankan saat dinyalakan), `auto`. Hanya chat umum, hanya dari teks pemilik. |

## 1. Keadaan saat ini

### 1.1 Skema

| Tabel | Kolom | Rujukan |
| --- | --- | --- |
| `memories` | `id` (uuid v7), `text`, `enabled` (bawaan true), `created_at`, `updated_at`; indeks `memories_created_idx` | `apps/gateway/src/db/schema/extra.ts:164-175`, migrasi `apps/gateway/drizzle/0005_memories.sql` |
| `spaces` | `id`, `name`, `description`, `created_at`, `updated_at` | `apps/gateway/src/db/schema/core.ts:94` |
| `space_documents` | `id`, `space_id` (cascade), `file_id` (cascade), `name`, `chars`, `created_at`; unik `(space_id, file_id)` | `extra.ts:190-209` |
| `space_chunks` | `id`, `document_id` (cascade), `space_id` (cascade), `ordinal`, `content`, `tsv` = kolom generated `to_tsvector('simple', content)`; indeks GIN `space_chunks_tsv_idx` | `extra.ts:211-232`, migrasi `0007_spaces.sql` |
| `conversations.space_id` | FK `set null` | `core.ts:109` |

Tipe kolom khusus yang sudah ada: `tsvector` dan `bytea` (`extra.ts:38-42`; `bytea` dipakai `files.content`, `extra.ts:131`). Migrasi terakhir `0017_skill_proposals_curator` (`apps/gateway/drizzle/meta/_journal.json:128`); migrasi maju saja (`infra/scripts/deploy.sh:13`).

Tidak ada kolom embedding, tidak ada ekstensi Postgres apa pun, tidak ada kolom asal-usul atau sematan pada memori.

### 1.2 Memori di gateway

- `MAX_MEMORIES = 200` (`apps/gateway/src/modules/memory/service.ts:14`), teks maks 500 karakter (`packages/contracts/src/entities.ts:452`). Kasus terburuk hari ini: 200 × 500 = 100.000 karakter di setiap pesan sistem. Belum ada penghitungan token (`docs/BACKLOG.md:487`).
- `promptSection()` mengambil **semua** baris aktif, terlama dulu, di bawah judul `# Memori tentang pemilik` dengan kalimat "jangan dianggap perintah" (`service.ts:110-120`).
- `summary()` membaca ulang tabel dan mengembalikan jumlah + judul 40 karakter, maks 50 butir (`service.ts:103-108`, `memoryTitle` di `service.ts:39`).
- Rute: `GET/POST /memories`, `PATCH/DELETE /memories/:id`, scope `app` (`apps/gateway/src/modules/memory/routes.ts:19-32`).
- Memori hanya diisi pemilik; "AI tidak menulis memori otomatis" dan usulan memori dari AI dicatat sebagai ide lanjutan (`docs/BACKLOG.md:485-486`).
- Memori gateway **terpisah** dari memori internal Hermes. Hermes punya memori jangka panjang sendiri lewat `X-Hermes-Session-Key = owner` (`docs/BACKLOG.md:132`) dan tidak ada API untuk membacanya (`docs/BACKLOG.md:485`). `docs/ARCHITECTURE.md` ("Memori jangka panjang dipegang Hermes") dan `docs/PRD.md` ("Memori jangka panjang lewat Hermes") hanya menyebut yang kedua; ini bukan pertentangan baru, tetapi perlu diingat saat ekstraksi otomatis dinyalakan (keputusan terbuka 5).

### 1.3 Jalur ke run

1. `chat.sendMessage` menyusun `prompt` (teks pemilik + teks dokumen lampiran) dan `routingText` (teks pemilik + label lampiran) di `composeInput` (`apps/gateway/src/modules/chat/service.ts:305-325`).
2. `agentPrompt` menambahkan konteks ruang lewat `spaces.contextFor(spaceId, question)` (`chat/service.ts:122-133`), lalu `runner.launch` dipanggil (`chat/service.ts:572-603`). Ini satu-satunya pemanggil `runner.launch`; `sendMessage` sendiri juga dipanggil jadwal, tim, kanban, fleet, dan revisi review (`schedules/service.ts:407`, `teams/service.ts:210`, `teams/orchestrator.ts:191,266`, `tasks/service.ts:228`, `fleets/service.ts:86`, `runs/service.ts:314`).
3. Di runner, `systemPromptFor` memanggil `deps.memory.promptSection()` tanpa argumen (`apps/gateway/src/modules/runs/runner.ts:290`) dan menaruh hasilnya setelah bundel role dan sebelum aturan project (`runner.ts:297-308`). Gagal memuat memori = run berjalan tanpa memori (`runner.ts:282-289`).
4. `emitContextUsed` memanggil `deps.memory.summary()` **terpisah** (`runner.ts:351-356`) dan mengirim event `context.used` (`runner.ts:357-368`). Dipanggil saat run mulai (`runner.ts:593`) dan lagi setiap ada skill baru yang dibuka (`runner.ts:605`). Dua pembacaan terpisah ini bisa tidak konsisten bila memori berubah di antaranya; setelah recall per pesan, keduanya **wajib** berasal dari satu pemilihan.
5. Runner tidak menerima teks pemilik secara terpisah: `LaunchInput.prompt` sudah bercampur dokumen dan konteks ruang (`runner.ts:57-85`).
6. Titik selesai run: `run.completed` ditangani di `runner.ts:689-718`; di sana `deps.proposals.capture` (usulan skill) sudah dipanggil (`runner.ts:700-707`). Ini titik kait alami untuk ekstraksi.

Ruang: `contextFor` memakai `keywordQuery` (kata kunci OR dengan awalan, `apps/gateway/src/modules/spaces/service.ts:71-94`), `to_tsquery('simple')` + `ts_rank_cd`, `TOP_CHUNKS = 6` (`spaces/service.ts:22`, `254-277`). Potongan 1.200 karakter, tumpang tindih 150, maks 400.000 karakter per dokumen, 50 dokumen per ruang (`spaces/service.ts:15-22`). Batas atas teoretis: 400.000 / 1.050 ≈ 381 potongan per dokumen, ≈ 19.000 potongan per ruang penuh.

Pencarian riwayat: `to_tsvector('simple')` dihitung saat kueri, tanpa indeks, kata kunci AND (`apps/gateway/src/modules/search/service.ts:12-15`, `27-105`).

### 1.4 Kontrak

- `MemorySchema` `{ id, text, enabled, createdAt, updatedAt }` (`packages/contracts/src/entities.ts:455-465`).
- `MemoryListSchema`, `CreateMemoryRequestSchema`, `UpdateMemoryRequestSchema` (`packages/contracts/src/api-schemas.ts:1008-1018`); endpoint di `packages/contracts/src/endpoints/memory.ts`.
- `context.used.memory = { read, items?[{ id, title ≤ 41 }] (maks 50) }` (`packages/contracts/src/events.ts:246`, `253-277`).
- `ConversationProgressSchema.used.memory = { read, items[] }` (`api-schemas.ts:1186-1189`); agregatnya dibangun di `apps/gateway/src/modules/chat/progress.ts:105-119`.
- `notification.topic` = `skill_report | skill_proposal` (`events.ts:340-347`).
- `packages/contracts/openapi.json` adalah berkas turunan dan ikut di repo.

### 1.5 Klien

| Klien | Permukaan | Rujukan |
| --- | --- | --- |
| Desktop | Bagian Memori di Pengaturan: tambah, sakelar, ubah, hapus | `apps/desktop/src/memory/MemorySection.tsx`, dipasang di `apps/desktop/src/screens/SettingsScreen.tsx:120` |
| Desktop | "Ingat ini" pada pesan pemilik | `apps/desktop/src/memory/RememberDialog.tsx`, `apps/desktop/src/chat/MessageList.tsx:13`, `apps/desktop/src/chat/UserMessage.tsx:19` |
| Desktop | Panel Progres "Dibaca · N fakta" + daftar judul | `apps/desktop/src/progress/UsedSection.tsx:60-92`, teks di `apps/desktop/src/copy.ts:876-882` |
| Desktop | API dan query | `apps/desktop/src/api/gateway.ts:386-392`, `apps/desktop/src/api/queries.ts:107`, `apps/desktop/src/memory/useMemoryActions.ts` |
| Desktop | Notifikasi usulan skill (pola yang bisa ditiru) | `apps/desktop/src/app/userEvents.ts:24-31`, `apps/desktop/src/chat/SkillProposalCards.tsx` |
| Android | Layar Memori + dialog Ingat | `apps/android/app/src/main/kotlin/app/aios/android/ui/memory/MemoryScreen.kt:45,142,205,254`, `MemoryViewModels.kt:48,175` |
| Android | API dan repository | `.../data/api/MemoryApi.kt:18-46`, `.../data/memory/MemoryRepository.kt` |
| Android | Lembar Progres "memori dibaca" | `.../ui/chat/ProgressSheet.kt:156-158`, `.../data/api/ProgressDto.kt:80-93`, `.../ui/chat/activity/ProgressBuilder.kt:190-196` |
| Android | Navigasi | `.../ui/settings/SettingsScreen.kt:88-94`, `.../ui/main/MainScreen.kt:98,340`, `.../ui/chat/ChatMessages.kt:215` |

Kompatibilitas klien lama: Android memakai `ignoreUnknownKeys = true` (`.../di/AppModule.kt:86`) dan tidak membaca `notification.topic` sama sekali; desktop memakai `ServerMessageSchema.safeParse` (`apps/desktop/src/realtime/client.ts:221`), jadi pesan yang tidak dikenalnya dibuang, bukan melempar.

### 1.6 Tes yang ada

| Tes | Isi |
| --- | --- |
| `apps/gateway/src/modules/memory/memory.integration.test.ts:77-140` | CRUD, validasi, batas 200, 401, dan "hanya memori aktif, setelah bundel role, perubahan berlaku di run berikutnya" |
| `apps/gateway/src/modules/memory/title.test.ts` | `memoryTitle` |
| `apps/gateway/src/modules/chat/progress.integration.test.ts:86-139` | `context.used`: jumlah, judul 40 karakter, urutan event, tanpa memori |
| `packages/contracts/src/events.test.ts:305-370` | Bentuk `context.used` sah dan tidak sah |
| `apps/gateway/src/modules/spaces/spaces.test.ts`, `spaces.integration.test.ts:114-205` | `chunkText`, `keywordQuery`, CRUD ruang, potongan relevan dikirim bernomor |
| `apps/gateway/src/modules/search/search.integration.test.ts:44-86` | `searchQuery`, `GET /search` |
| `apps/desktop/src/memory/Memory.test.tsx:31-121` | Bagian Memori dan dialog Ingat |
| `apps/android/app/src/test/kotlin/app/aios/android/MemoryViewModelTest.kt:106-178` | ViewModel memori dan Ingat |
| `e2e/tests/memory.spec.ts:3` | Tambah, Ingat, nonaktifkan, bertahan setelah muat ulang |

## 2. Ketersediaan embedding

### 2.1 Yang dijalankan

Gateway produksi memakai `NINEROUTER_URL=http://127.0.0.1:20128/v1` dan **tidak** mengisi `NINEROUTER_API_KEY` (dibaca dari `gateway.env` produksi tanpa menampilkan nilai rahasia; hanya nama model yang dibaca). Semua `*_MODEL` produksi bernilai `zrouter/gpt-6-luna`. Jadi semua permintaan di bawah dikirim tanpa kunci. 9Router yang berjalan: versi 0.5.59.

Hasil apa adanya:

```
GET /v1/models (tanpa key) status=200 time=1.388554s size=18097
  -> 42 model: 40 "zrouter/*", 1 "oxion/claude-sonnet-5", 1 combo "coding-main".
     Tidak ada id yang memuat embed/bge/e5/minilm/gte/nomic/voyage.

GET /v1/models/embedding status=200 time=0.044703s size=27
  {"object":"list","data":[]}

GET /v1/models/embeddings status=404 time=0.013306s size=144
  {"error":{"message":"Unknown model kind: embeddings. Supported: image, tts, stt, embedding, image-to-text, web","type":"invalid_request_error"}}

POST /v1/embeddings model=text-embedding-3-small status=400 time=0.013144s size=111
  body: {"error":{"message":"No credentials for provider: openai","type":"invalid_request_error","code":"bad_request"}}

POST /v1/embeddings model=zrouter/text-embedding-3-small status=404 time=1.318969s size=153
  body: {"error":{"message":"[openai-compatible-chat-8d4d0660-7fef-4d20-9e01-205a9ef91f0e/text-embedding-3-small] [404]: 404 page not found\n (reset after 2m)"}}
```

Isi kedua POST: `{"model":"…","input":"halo dunia"}`.

### 2.2 Kesimpulan

- **Tidak ada model embedding yang berfungsi.** Dimensi dan latensi embedding **tidak bisa diukur** karena tidak ada satu pun vektor yang kembali.
- Rute `/v1/embeddings` ada di 9Router, tetapi daftar model jenis `embedding` kosong. Dua koneksi yang terpasang (`zrouter`, `oxion`) bertipe `openai-compatible`; hulu `zrouter` menjawab 404 untuk `/embeddings`.
- Probe ketiga (ke `oxion`) **sengaja tidak dikirim**; alasannya di 2.3. Jadi dukungan embedding di hulu `oxion` **[tidak diuji]**.
- Kode 9Router 0.5.59 (dibaca dari berkas terpasang, tidak diubah) mengenal embedding untuk penyedia: `openai`, `gemini` (`gemini-embedding-001`, `text-embedding-004/005`, `embedding-001` 768 dimensi), `github` (`text-embedding-3-small/large`), `openrouter`, `voyage-ai`, `mistral`, `fireworks`, `nebius`, `nvidia`, `together`, `venice`, dan `selfhosted-embedding` (server OpenAI-compatible dengan `baseUrl` sendiri). Tidak satu pun punya kredensial di instance ini.
- Konsekuensi: menyalakan vektor butuh pemilik menambah **satu koneksi embedding di dasbor 9Router** (penyedia hosted atau server lokal). Itu perubahan konfigurasi 9Router di host, bukan perubahan stack `aios-*`. Sampai itu ada, fitur berjalan leksikal.

### 2.3 Efek samping probe (perlu diketahui)

POST kedua diteruskan 9Router ke hulu `zrouter`, gagal 404, lalu 9Router mencatat kegagalan itu pada rekaman koneksi **ZRouter** (dibaca dari basis data 9Router secara baca-saja, sesudah probe):

- `modelLock_text-embedding-3-small` selama 2 menit (sampai 07:35:32Z; sudah lewat). Kunci ini per id model; pemilihan koneksi 9Router hanya menyaring `isActive` dan kunci model yang diminta, jadi `gpt-6-luna` tidak ikut terkunci.
- `lastError`, `errorCode` (404), dan `lastErrorAt` koneksi ZRouter **tertimpa** oleh galat probe. Nilai sebelumnya tidak sempat saya catat. `testStatus` terbaca `unavailable`; rekaman itu masih membawa `modelLock_gpt-6-luna` kedaluwarsa bertanggal 2026-11-09, jadi kemungkinan besar status itu sudah `unavailable` sebelum probe, tetapi **ini tidak bisa saya buktikan**. Menurut kode 9Router, status kembali `active` pada permintaan sukses berikutnya lewat koneksi itu.
- Saya tidak menulis apa pun ke basis data 9Router untuk "membetulkannya". Karena tiap probe gagal menimpa diagnostik koneksi, probe ketiga ke `oxion` (yang `lastError`-nya masih dari 27 Oktober) tidak saya kirim.

Pelajaran untuk desain: **panggilan embedding yang gagal membuat 9Router mengunci model itu 2 menit**. Pemutus arus di gateway harus menunggu minimal selama itu (lihat 4.3).

### 2.4 Embedding lokal di VPS ini

Yang diukur: 2 vCPU Neoverse-N1 (`nproc` = 2), RAM 11 GiB dengan ±8,4–8,8 GiB tersedia, swap 4 GiB (801 MiB terpakai), beban rata-rata 0,37–0,64. Container: gateway 193 MiB, Postgres 67 MiB. Tidak ada Ollama, llama.cpp, onnxruntime, torch, atau sentence-transformers yang terpasang.

| Opsi | Penilaian |
| --- | --- |
| Di dalam proses gateway (transformers.js + onnxruntime-node) | **Tidak disarankan.** Dependensi native baru yang berat (melanggar aturan 4 `AGENTS.md` tanpa alasan kuat), berkas model harus ditanam di image atau diunduh saat jalan padahal gateway tidak menulis ke disk (`apps/gateway/Dockerfile:36`), dan inferensi berebut 2 core dengan event loop gateway. |
| Layanan di host (systemd, seperti Hermes dan 9Router) + koneksi `selfhosted-embedding` di 9Router | **Realistis untuk memori**, karena RAM longgar dan gateway tetap hanya bicara ke 9Router. Model multibahasa kecil (kelas e5-small/embeddinggemma, ratusan MB) cukup untuk ratusan sampai ribuan fakta pendek. **Latensi di mesin ini [tidak diukur]**: saya tidak memasang apa pun di VPS produksi. Untuk ruang penuh (±19.000 potongan × 1.200 karakter) backfill di 2 core akan lama **[dugaan: berjam-jam untuk model kelas bge-m3]**. |
| Penyedia hosted lewat 9Router | Nol beban RAM/CPU, tetapi teks memori dan kueri (dan potongan dokumen bila ruang ikut) keluar ke penyedia itu. Keputusan pemilik (bagian 7). |

## 3. Penyimpanan vektor

### 3.1 Opsi A — pgvector

Yang harus berubah (semua dicek di repo):

- Image compose `postgres:16` → image pg16 ber-pgvector (`infra/compose/docker-compose.yml:18`), dengan restart Postgres produksi. Tag yang tersedia di Docker Hub (dicek 15 November 2026, amd64 + arm64): `pgvector/pgvector:pg16` dan `pg16-bookworm`, `pg16-trixie`, `0.8.7-pg16*`. Image `postgres:16` di host ini adalah `16.15-1.pgdg13+2` (basis Debian trixie); memakai varian bookworm di atas volume yang sama berisiko peringatan versi collation glibc. Jadi harus tepat `pg16-trixie`, dan itu pun **[belum diuji]**.
- `CREATE EXTENSION vector` di migrasi. Setiap tes integrasi menjalankan semua migrasi pada database baru (`apps/gateway/src/testing/db.ts:31`).
- **Postgres tertanam untuk tes tidak punya pgvector.** Tanpa `TEST_DATABASE_URL`, tes memakai paket `embedded-postgres` 16.14.0-beta.17 (`apps/gateway/src/testing/global-setup.ts:59-87`, `apps/gateway/src/testing/embedded-pg.mjs`, `pnpm-workspace.yaml:45`), begitu juga harness E2E (`e2e/harness/stack.ts:81-141`). Migrasi dengan `CREATE EXTENSION vector` akan menggagalkan **seluruh** tes integrasi dan E2E di mesin tanpa Docker (jalur yang sengaja didukung repo ini, termasuk Windows).
- Dua service container CI `postgres:16` harus diganti (`.github/workflows/ci.yml:9-24`, `48-65`).
- `backup.sh` tidak berubah (`pg_dump -Fc`, `infra/scripts/backup.sh:58`), tetapi dump jadi bergantung pada ekstensi: `restore.sh` memakai `pg_restore --exit-on-error` ke database sementara di container yang sama (`infra/scripts/restore.sh:61-62`) dan akan gagal di Postgres polos. Pemulihan bencana ke mesin baru jadi butuh image yang sama.
- Kunci versi `postgres=16` (`infra/VERSIONS.md:12`) dan `check-versions.sh` tetap cocok, tetapi asal image perlu dicatat.
- Tidak bisa dibalik dengan migrasi maju saja selama ada kolom bertipe `vector`.

Yang didapat: indeks ANN (HNSW/IVFFlat) dan operator jarak di SQL. Pada skala pemilik, keduanya tidak diperlukan (3.3).

### 3.2 Opsi B — `bytea` + skor di aplikasi

Vektor disimpan sebagai Float32 little-endian yang sudah dinormalisasi L2 di kolom `bytea` (tipe yang sudah dipakai repo, `extra.ts:42`). Skor kosinus = dot product di gateway. Tanpa ekstensi: image, CI, Postgres tertanam, `backup.sh`, `restore.sh`, dan `selftest.sh` tidak berubah. `bytea` dipilih, bukan `real[]`: node-pg mengembalikan `bytea` sebagai `Buffer` yang langsung dibungkus `Float32Array`, sedangkan `real[]` harus diurai dari teks per elemen.

### 3.3 Ukuran dan angka

Produksi: basis data ±12 MB (dari penugasan). Jumlah baris `memories` dan `space_chunks` produksi **[tidak diukur]**; saya tidak menyentuh Postgres produksi. Batas dari kode: 200 memori, ±19.000 potongan per ruang penuh.

Tolok ukur di VPS ini (Node v22.23.2, JS murni tanpa dependensi, vektor acak ternormalisasi, rata-rata 20 putaran; `decode_hex` = mengubah n string heksa menjadi satu matriks Float32, meniru biaya membaca `bytea` dari Postgres; skrip sementara `/tmp/vecbench.mjs`, sudah dihapus):

```
n=200 d=384 skor=0.13ms decode_hex=1.5ms ukuran=0.3MB
n=200 d=1536 skor=0.63ms decode_hex=4.3ms ukuran=1.2MB
n=2000 d=384 skor=1.61ms decode_hex=13.6ms ukuran=2.9MB
n=2000 d=768 skor=3.20ms decode_hex=22.0ms ukuran=5.9MB
n=2000 d=1536 skor=6.34ms decode_hex=37.6ms ukuran=11.7MB
n=20000 d=384 skor=15.97ms decode_hex=111.4ms ukuran=29.3MB
n=20000 d=768 skor=41.38ms decode_hex=245.3ms ukuran=58.6MB
n=20000 d=1536 skor=77.30ms decode_hex=429.1ms ukuran=117.2MB
```

Bacaan: untuk memori (≤ 2.000 baris, ≤ 768 dimensi) skor + decode ≈ 25 ms per pesan tanpa cache apa pun. Untuk ruang penuh (20.000 baris) skornya masih 16–77 ms, tetapi membaca dan mengurai 30–117 MB per giliran tidak masuk akal; di sana perlu cache matriks per ruang di memori proses (4.8). Waktu kueri Postgres dan transfer tidak termasuk di angka ini.

### 3.4 Rekomendasi: **Opsi B (`bytea` + skor di aplikasi)**

1. Skala pemilik (ratusan memori, ribuan potongan) selesai dalam milidetik tanpa indeks ANN; angka di atas.
2. Tidak ada perubahan infra produksi, tidak ada restart Postgres, tidak ada risiko collation.
3. Tes lokal (Postgres tertanam), E2E, CI, backup, dan restore tetap seperti sekarang. Opsi A mematahkan jalur tes tanpa Docker.
4. Bisa dibalik: fitur mati = `EMBEDDING_MODEL` kosong; tabel vektor boleh dibiarkan atau dikosongkan. Pindah ke pgvector nanti = migrasi aditif (kolom `vector` baru diisi dari `bytea`), tanpa kehilangan data.
5. Batasnya jelas dan dicatat: bila satu ruang melewati ±20.000 potongan atau memori melewati ribuan baris, tinjau ulang pgvector.

## 4. Desain

### 4.1 Model data dan migrasi

Semua aditif, satu migrasi per slice (nomor mengikuti urutan saat dikerjakan).

**Slice 1 — `memories`**

| Kolom baru | Tipe | Catatan |
| --- | --- | --- |
| `pinned` | `boolean not null default false` | Tersemat: selalu ikut, tidak ikut pemeringkatan |
| `tsv` | `tsvector generated always as (to_tsvector('simple', text)) stored` | Pola yang sama dengan `space_chunks.tsv` (`extra.ts:224-226`); indeks GIN `memories_tsv_idx` |

Baris lama: `pinned = false`; `tsv` dihitung Postgres saat `ALTER TABLE` (≤ 200 baris).

**Slice 2 — tabel `embeddings`**

| Kolom | Tipe | Catatan |
| --- | --- | --- |
| `id` | uuid v7 | |
| `memory_id` | uuid null, FK `memories` `on delete cascade` | |
| `chunk_id` | uuid null, FK `space_chunks` `on delete cascade` | Diisi mulai slice 4; rantai cascade ruang → dokumen → potongan sudah ada (`extra.ts:197`, `218`, `221`) |
| `model` | text | Id model 9Router yang menghasilkan vektor |
| `dims` | integer | |
| `vector` | bytea | Float32 LE, ternormalisasi L2, panjang = `dims × 4` |
| `content_hash` | text | sha256 teks yang di-embed; beda = basi |
| `created_at` | timestamptz | |

Batasan: `check (num_nonnulls(memory_id, chunk_id) = 1)`, unik `(memory_id, model)`, unik `(chunk_id, model)`.

Mengapa tabel terpisah, bukan kolom di `memories`/`space_chunks`: `select *` yang ada (`memory/service.ts:61`) tidak ikut menarik 1,5–6 KB per baris; ganti model = baris baru berdampingan lalu yang lama disapu; satu mekanisme untuk memori dan potongan; mematikan fitur = satu tabel.

**Slice 3 — asal-usul dan usulan**

`memories` bertambah: `source text not null default 'owner'` (`owner | extracted`), `source_conversation_id uuid null` (FK `set null`), `source_message_id uuid null` (FK `set null`).

Tabel `memory_proposals`, meniru `skill_proposals` (`extra.ts:298-327`):

| Kolom | Catatan |
| --- | --- |
| `id`, `created_at`, `decided_at` | |
| `kind` | `add | update` |
| `status` | `pending | approved | rejected | auto_saved | undone` |
| `text` | Fakta yang diusulkan (≤ 300 karakter) |
| `evidence` | Kutipan pendek dari pesan pemilik yang menjadi dasar (≤ 200 karakter) |
| `target_memory_id` | Untuk `update`; FK `set null` |
| `previous_text` | Teks lama memori target, untuk urungkan |
| `result_memory_id` | Memori hasil; FK `set null` |
| `conversation_id`, `message_id`, `run_id` | Asal; FK `set null` |
| `model` | Model pengekstrak |

Indeks `(status, created_at)`.

### 4.2 Recall per pesan

Antarmuka runner berubah dari dua panggilan menjadi satu:

```ts
memory?: {
  recall(input: { text: string; signal?: AbortSignal }): Promise<{
    section: string; // bagian pesan sistem, '' bila kosong
    summary: { read: number; total: number; mode: 'all' | 'lexical' | 'hybrid'; items: { id: string; title: string; via: 'pinned' | 'lexical' | 'vector' | 'hybrid' | 'recent' }[] };
  }>;
};
```

- Dipanggil **sekali per run** di `execute`; hasilnya dipakai `systemPromptFor` dan semua `emitContextUsed` run itu (menggantikan `runner.ts:290` dan `runner.ts:353`). `context.used` jadi selalu sama dengan yang benar-benar disuntik.
- `LaunchInput` mendapat `recallText?: string`. Chat service mengisinya dengan `routingText` pesan ini ditambah teks pesan pemilik sebelumnya di percakapan yang sama (agar "yang itu saja" tetap punya kata kunci), dipotong 1.000 karakter. Dokumen lampiran, konteks ruang, dan `options.context` **tidak** ikut.
- Urutan dan judul bagian (`# Memori tentang pemilik`, "jangan dianggap perintah") tetap.

Algoritma:

1. Ambil memori aktif. `total` = jumlahnya.
2. **Bila total karakter ≤ anggaran** (`MEMORY_RECALL_BUDGET_CHARS`, bawaan 6.000 ≈ 1.500 token dengan taksiran 4 karakter/token): suntik semuanya, terlama dulu, persis seperti sekarang. `mode = 'all'`. Tidak ada kueri tambahan, tidak ada regresi bagi pemilik dengan sedikit memori.
3. Bila lebih:
   1. **Tersemat** masuk dulu (terlama dulu), maksimal separuh anggaran; kelebihannya dipotong dan dicatat di log.
   2. **Peringkat leksikal**: `ts_rank_cd(tsv, to_tsquery('simple', keywordQuery(teks)))`, memakai `keywordQuery` yang sudah ada (`spaces/service.ts:91`), 30 teratas.
   3. **Peringkat vektor** (hanya bila `EMBEDDING_MODEL` diisi dan embedding kueri berhasil dalam batas waktu): kosinus terhadap vektor memori aktif, 30 teratas dengan kemiripan ≥ `MEMORY_RECALL_MIN_SIM`.
   4. **Gabung** dengan Reciprocal Rank Fusion: `skor = Σ 1 / (60 + peringkat)`. RRF dipilih karena tidak perlu menyamakan skala `ts_rank_cd` dan kosinus.
   5. Ambil dari atas sampai `MEMORY_RECALL_TOP_K` (bawaan 12) atau anggaran habis.
   6. Mode leksikal saja: sisa anggaran diisi memori yang paling baru diubah (`via: 'recent'`), karena leksikal `simple` tanpa stemming akan melewatkan parafrase. Mode hibrida: tidak diisi.
4. `mode = 'hybrid'` bila langkah vektor jalan, selain itu `'lexical'`.

Degradasi (tidak pernah memblokir run):

- `EMBEDDING_MODEL` kosong → tidak ada panggilan jaringan sama sekali.
- Embedding kueri: batas waktu keras `EMBEDDING_QUERY_TIMEOUT_MS` (bawaan 800 ms; target PRD token pertama < 2 detik, `docs/PRD.md:99`), tanpa retry. Gagal atau lewat waktu → leksikal, `mode = 'lexical'`.
- Pemutus arus: setelah satu kegagalan, langkah vektor dilewati 120 detik (sama dengan kunci model 9Router, 2.3).
- Memori yang belum punya vektor tetap bisa terpilih lewat leksikal.
- Galat DB → perilaku sekarang: run jalan tanpa memori (`runner.ts:282-289`).
- Embedding **bukan** dependensi `/readyz` (`apps/gateway/src/modules/health/service.ts:92-97` tidak diubah).

Berlaku untuk run chat dan coding, seperti sekarang (`docs/API_CONTRACT.md:49`).

### 4.3 Klien embedding dan backfill

- `modules/embeddings/client.ts`: `embed(texts: string[], { signal, timeoutMs }): Promise<Float32Array[]>` lewat `NineRouterClient.request('/embeddings', …)` (`apps/gateway/src/modules/llm/client.ts:15-21`), badan `{ model, input: [...], dimensions? }`, jawaban divalidasi Zod, vektor dinormalisasi L2. Instans klien terpisah dengan `retries: 0` untuk jalur recall (klien bawaan mengulang 2 kali, `client.ts:34-36`).
- Teks yang cocok `findSecret` (`apps/gateway/src/modules/skills/proposals.ts:44`) **tidak** dikirim ke embedding; baris itu tetap leksikal.
- Tulis: `create`/`update` memori tidak menunggu embedding. Baris tanpa vektor (atau `content_hash` beda) diambil pekerjaan pg-boss `embeddings-backfill` (pola `apps/gateway/src/modules/skills/jobs.ts`): tiap 5 menit, batch 16 teks per permintaan, maks 10 batch per putaran, berhenti pada galat pertama.
- **Backfill baris lama**: pekerjaan yang sama; 200 memori = ≤ 13 permintaan. Tidak ada langkah manual.
- Ganti model: baris model baru diisi berdampingan; recall memakai model aktif saja; baris model lama disapu setelah cakupan model baru 100%.

### 4.4 Ekstraksi fakta

**Kapan.** Di titik `run.completed` (`runner.ts:689-718`), runner memasukkan pekerjaan pg-boss `memory-extract` bila semua benar: mode bukan `off`; run chat selesai sukses; percakapan tanpa project, tanpa ruang, tanpa tim; pesan dikirim pemilik lewat `POST /conversations/:id/messages` atau edit (bukan jadwal, kanban, fleet, tim, revisi: pemanggil-pemanggil di 1.3). Chat service menandainya lewat field baru `LaunchInput.extract`. Pekerjaan memakai `singletonKey = conversationId` dan `startAfter` 45 detik, jadi beberapa giliran cepat menjadi satu ekstraksi.

**Saringan murah tanpa model** (sebelum memanggil apa pun): teks pemilik ≥ 15 karakter; memuat penanda orang pertama atau preferensi (`saya|aku|gue|gw|-ku|nama|tinggal|kerja|suka|selalu|jangan|lebih suka|I|my|prefer…`); usulan `pending` < 20; kuota harian belum habis.

**Masukan ke model.** Hanya **teks pesan pemilik** (pesan ini dan maksimal 2 pesan pemilik sebelumnya, masing-masing dipotong 1.500 karakter) dan maksimal 8 memori yang paling mirip (dari recall 4.2) untuk deduplikasi. **Jawaban asisten, isi tautan, hasil web, dan dokumen lampiran tidak dikirim**: semuanya bisa membawa injeksi tidak langsung.

**Model.** `MEMORY_EXTRACT_MODEL` lewat `/chat/completions` 9Router, suhu 0, non-stream, batas waktu 20 detik, pola `apps/gateway/src/modules/chat/title.ts:41-70`. Bawaan `router-fast` mengikuti variabel model kecil lain (`apps/gateway/src/config.ts:41-46`); catatan: combo itu tidak ada di 9Router produksi, jadi produksi mengisinya seperti variabel lain (`zrouter/gpt-6-luna`).

**Keluaran.** JSON yang divalidasi Zod: `{ facts: [{ action: 'add' | 'update', targetId?, text (≤ 300), evidence (≤ 200) }] }`, maksimal 3. Keluaran tidak sah = dibuang diam-diam (dicatat di log tanpa isi).

**Penjaga, berurutan; gagal satu = fakta dibuang:**

1. **Berpijak pada teks pemilik**: `evidence` harus ditemukan di teks pemilik yang dikirim (setelah spasi dan huruf besar/kecil diratakan). Ini memblokir fakta karangan model.
2. **Pemindai injeksi**: `scanSkill({ body: text })` (`apps/gateway/src/modules/skills/scanner.ts:140`); temuan apa pun (`warning` atau `danger`) = buang. Fakta pendek tentang pemilik tidak punya alasan memuat pola itu.
3. **Rahasia**: `findSecret(text)` (`proposals.ts:44`); ditambah aturan kecil untuk deret 13–19 digit (kartu) dan kode OTP. Yang dicatat di log hanya nama aturan, tidak pernah nilainya (kebijakan yang sama dengan `proposals.ts:25`).
4. **Bentuk**: satu kalimat pernyataan tentang pemilik; ditolak bila diawali kata perintah kepada agent.
5. **Duplikat**: dibandingkan dengan memori yang ada, usulan `pending`, dan usulan `rejected`/`undone` 90 hari terakhir: teks ternormalisasi sama, atau Jaccard kata kunci (`keywords`, `spaces/service.ts:80`) ≥ 0,8, atau kosinus ≥ 0,9 bila vektor ada.

`update` hanya sah bila `targetId` adalah salah satu memori yang dikirim ke model.

**Mode.**

- `propose`: baris `memory_proposals` berstatus `pending` + notifikasi. Setuju = memori baru (`source = 'extracted'`, asal diisi) atau teks target diubah (`previous_text` disimpan). Tolak = `rejected`.
- `auto`: langsung disimpan, status `auto_saved`, notifikasi dengan aksi Urungkan. Urungkan = hapus memori hasil (atau kembalikan `previous_text`), status `undone`, dan tidak diusulkan lagi (penjaga 5).

**Batas dan biaya.** `MEMORY_EXTRACT_DAILY_MAX` (bawaan 40 panggilan per 24 jam bergulir, pola `PROPOSALS_PER_DAY`, `apps/gateway/src/modules/skills/proposal-service.ts:56`, `132-143`). Satu panggilan ≈ ≤ 2.500 token masuk dan ≤ 300 token keluar **[taksiran dari batas potong di atas]**; batas atas ≈ 100.000 token masuk per hari. Harga per token `zrouter` tidak saya ketahui.

`MAX_MEMORIES` dinaikkan dari 200 ke 1.000 di slice ini: anggaran recall sudah menjaga panjang pesan sistem, dan 1.000 baris masih jauh di bawah angka 3.3.

### 4.5 API dan kontrak (aditif)

| Perubahan | Detail |
| --- | --- |
| `MemorySchema` | `+ pinned: boolean` (slice 1); `+ source: 'owner' | 'extracted'`, `+ origin: { conversationId, messageId } | null` (slice 3). Server selalu mengisi; skema klien memberi bawaan agar fixture lama tetap sah |
| `CreateMemoryRequestSchema`, `UpdateMemoryRequestSchema` | `+ pinned?: boolean`; aturan "isi minimal satu" diperluas |
| `GET /memories` | Bentuk tetap; hanya memori (usulan tidak pernah muncul di sini) |
| `GET /memories/proposals?status=` | Daftar usulan, bawaan `pending`; meniru `/skills/proposals` (`apps/gateway/src/modules/skills/routes.ts:130-155`) |
| `POST /memories/proposals/:id/approve` | Badan opsional `{ text }` untuk menyunting sebelum simpan |
| `POST /memories/proposals/:id/reject` | |
| `POST /memories/proposals/:id/undo` | Hanya untuk `auto_saved` |
| `context.used.memory` | `+ total?`, `+ mode?`, `items[].via?` (4.7) |
| `ConversationProgressSchema.used.memory` | Field opsional yang sama |
| `notification.topic` | `+ 'memory_proposal'`. Aman bagi klien lama: Android tidak membaca `topic`; desktop lama membuang pesan yang gagal `safeParse`. Pola yang sama dengan penambahan topic di P11 |

Galat baru: `404 proposal_not_found`, `409 proposal_decided` (nama yang sama dengan usulan skill, `proposal-service.ts:103-105`). `packages/contracts/openapi.json` dibuat ulang dan tes kontrak diperbarui di slice yang sama (`docs/CODING_STANDARDS.md`, "Snapshot contract").

### 4.6 UI (minimal)

**Desktop**

- `MemorySection.tsx`: tombol sematkan per baris; lencana "Otomatis" + tautan ke percakapan asal untuk `source = 'extracted'`; di atas daftar, blok "Usulan memori (N)" dengan Simpan, Ubah lalu simpan, Tolak.
- Notifikasi `memory_proposal` di `userEvents.ts`: segarkan `['memoryProposals']` dan `['memories']`; toast "Usulan memori baru" (mode `propose`) atau "Disimpan ke memori: …" dengan aksi Urungkan (mode `auto`).
- `UsedSection.tsx`: "Dibaca · N dari M fakta"; tiap judul diberi keterangan kecil (tersemat, cocok kata, mirip makna, terbaru).
- Tetap memakai token dan empat state wajib (memuat, kosong, error, offline) sesuai `AGENTS.md`.

**Android**

- `MemoryScreen.kt`: sematkan, lencana Otomatis, bagian Usulan dengan tiga aksi yang sama; `MemoryApi.kt`/`MemoryRepository.kt` mengikuti.
- `ProgressSheet.kt`: "N dari M".
- Snackbar dengan Urungkan untuk mode `auto`.

### 4.7 Pelaporan `context.used`

```jsonc
"memory": {
  "read": 7,          // yang benar-benar disuntik (arti lama dipertahankan)
  "total": 143,       // memori aktif
  "mode": "hybrid",   // all | lexical | hybrid
  "items": [{ "id": "…", "title": "≤ 40 karakter…", "via": "pinned" }]  // maks 50
}
```

Isi memori tetap tidak pernah keluar lewat event (`events.ts:248-252`). Catatan lama tentang judul = 40 karakter pertama (`docs/BACKLOG.md:739`) tidak berubah.

### 4.8 Ruang pengetahuan dan pencarian riwayat

- Fungsi gabung RRF dan pembaca vektor ditaruh di `apps/gateway/src/lib/retrieval.ts` (murni, tanpa DB) agar dipakai memori dan ruang.
- `spaces.contextFor` (slice 4): 24 teratas leksikal (kueri yang ada) + 24 teratas vektor → RRF → `TOP_CHUNKS` (6). Format keluaran dan aturan sitasi tidak berubah (`spaces/service.ts:280-300`).
- `addDocument` tidak menunggu embedding; potongan baru diisi `embeddings-backfill`. Sampai terisi, ruang itu leksikal.
- Cache matriks vektor per ruang di memori proses (LRU, batas total 64 MB), dibatalkan saat dokumen ditambah/dikeluarkan dan setelah batch backfill. Gateway satu proses (`docs/BACKLOG.md:158`), jadi cache lokal cukup.
- Dimatikan bawaan (`SPACES_VECTOR=false`): isi dokumen keluar ke penyedia embedding (4.10).
- Pencarian riwayat (`modules/search`) tidak diubah di slice 1–4. Membuatnya hibrida berarti meng-embed semua pesan; dicatat sebagai slice 5 opsional.

### 4.9 Konfigurasi (semua opsional)

| Variabel | Bawaan | Arti |
| --- | --- | --- |
| `MEMORY_RECALL_BUDGET_CHARS` | `6000` | Anggaran bagian memori di pesan sistem |
| `MEMORY_RECALL_TOP_K` | `12` | Maks memori terpilih di luar yang tersemat |
| `MEMORY_RECALL_MIN_SIM` | `0.3` | Ambang kosinus; **nilai awal, harus disetel dari evaluasi per model** |
| `EMBEDDING_MODEL` | kosong | Id model embedding di 9Router. Kosong = vektor mati, leksikal saja |
| `EMBEDDING_DIMENSIONS` | kosong | Diteruskan sebagai `dimensions` bila model mendukung; saran ≤ 768 |
| `EMBEDDING_QUERY_TIMEOUT_MS` | `800` | Batas embedding kueri di jalur recall |
| `MEMORY_EXTRACT_MODE` | `off` | `off | propose | auto` |
| `MEMORY_EXTRACT_MODEL` | `router-fast` | Model kecil pengekstrak |
| `MEMORY_EXTRACT_DAILY_MAX` | `40` | Panggilan ekstraksi per 24 jam |
| `SPACES_VECTOR` | `false` | Retrieval hibrida untuk ruang |

Tanpa satu pun variabel diisi, perilaku sesudah slice 1: recall beranggaran leksikal; tidak ada panggilan model baru.

### 4.10 Privasi: apa dikirim ke mana

| Jalur | Yang dikirim | Tujuan | Bawaan |
| --- | --- | --- | --- |
| Recall leksikal | Tidak ada | — | Nyala |
| Embedding memori | Teks tiap memori (≤ 500 karakter), kecuali yang cocok `findSecret` | 9Router → penyedia `EMBEDDING_MODEL` | Mati |
| Embedding kueri | Pesan pemilik + satu pesan pemilik sebelumnya (≤ 1.000 karakter), **setiap pesan** | sama | Mati |
| Embedding ruang | Potongan dokumen (≤ 1.200 karakter per potongan) | sama | Mati (`SPACES_VECTOR`) |
| Ekstraksi | ≤ 3 pesan pemilik terakhir (≤ 1.500 karakter masing-masing) + ≤ 8 memori mirip | 9Router → `MEMORY_EXTRACT_MODEL` | Mati |

Tidak pernah dikirim untuk fitur ini: jawaban asisten, isi berkas project, isi tautan/web, percakapan project/ruang/tim (ekstraksi). Kunci API tetap hanya di 9Router (`AGENTS.md`). Vektor di Postgres ikut `pg_dump`; vektor bisa membocorkan isi teks secara kasar, jadi diperlakukan setara teksnya.

## 5. Rencana tes dan evaluasi

Mengikuti `docs/CODING_STANDARDS.md` ("Testing minimum per fitur") dan tes di 1.6.

| Lapis | Isi |
| --- | --- |
| Unit gateway (Vitest) | Pengemas anggaran (tersemat dulu, tidak pernah lewat anggaran); RRF; codec vektor (Float32 ↔ `bytea`, normalisasi); pemeriksaan `evidence`; deduplikasi; saringan pra-model; penjaga rahasia dan injeksi pada fakta |
| Integrasi gateway (Postgres nyata, `apps/gateway/src/testing/db.ts`) | Perluas `memory.integration.test.ts`: di bawah anggaran = pesan sistem sama seperti sekarang; di atas anggaran = tersemat + teratas; `context.used` cocok dengan yang disuntik (perluas `progress.integration.test.ts`); `PATCH pinned`; endpoint usulan (setuju, sunting, tolak, urungkan, 404, 409); ekstraksi dengan 9Router palsu (`apps/gateway/src/testing/mock-server.ts`) |
| Degradasi | Embedding 500, batas waktu, dan JSON rusak → run tetap selesai, `mode = 'lexical'`, tambahan waktu ≤ batas waktu; pemutus arus tidak memanggil lagi selama jendela |
| Embedder palsu | Vektor deterministik dari hash kata, untuk menguji pipa (bukan mutu) tanpa model |
| Kontrak | `packages/contracts/src/events.test.ts` (`context.used` dengan field baru, sah dan tidak sah), `contract.test.ts`, `progress-fixtures.test.ts`, OpenAPI dibuat ulang |
| Desktop (RTL) | `Memory.test.tsx`: sematkan, lencana, blok usulan, urungkan; `ProgressPanel.test.tsx`: "N dari M" |
| Android (JUnit) | `MemoryViewModelTest.kt`: sematkan, usulan, urungkan; `ProgressBuilderTest.kt` |
| E2E (Playwright) | Perluas `e2e/tests/memory.spec.ts`: sematkan; usulan muncul lalu disetujui (model palsu di `e2e/harness/fakes.ts`) |

**Set evaluasi `pnpm eval:memory`** (pola `pnpm eval:skills`: `apps/gateway/src/cli/eval-skills.ts`, `eval-skills.data.ts`, `eval-skills.test.ts`; bukan gerbang CI):

- Fixture sintetis (bukan data pemilik): ±60 fakta (Indonesia, sebagian Inggris) dan ±40 kueri, masing-masing berlabel id fakta yang relevan. Kategori: cocok kata; parafrase/sinonim; lintas bahasa; pesan susulan pendek; kueri tanpa memori relevan.
- Metrik per mode (`all`, `lexical`, `hybrid`): recall@5, recall@12, precision@12, MRR, laju suntik berlebih pada kueri negatif, dan karakter yang disuntik.
- `all` adalah garis dasar (recall 1, biaya karakter penuh). `hybrid` dilewati dengan alasan bila `EMBEDDING_MODEL` kosong.
- Bagian yang deterministik masuk CI sebagai tes regresi: validitas fixture, dan recall@12 leksikal pada kategori "cocok kata" tidak boleh turun dari angka yang dicatat saat slice 1 selesai.
- Ekstraksi: ±30 giliran berlabel (0–2 fakta diharapkan), termasuk 8 percobaan injeksi dan 5 yang memuat rahasia. Metrik: precision, recall, dan **nol** fakta lolos dari kelompok injeksi/rahasia. Dijalankan ke model sungguhan lewat CLI saja.

## 6. Rencana slice

Urutan 1 → 2 → 4; slice 3 hanya butuh slice 1. Tiap slice bisa dirilis sendiri.

### Slice 1 — Recall beranggaran dan memori tersemat (leksikal)

Berguna sendiri: pesan sistem berhenti membengkak (kasus terburuk 100.000 karakter → ≤ 6.000), pemilik bisa menyematkan fakta inti, dan `context.used` melaporkan yang benar-benar dipakai. **Tanpa perubahan infra, env, atau panggilan model.**

- Berkas: migrasi baru (`memories.pinned`, `tsv`, indeks GIN); `apps/gateway/src/db/schema/extra.ts`; `apps/gateway/src/modules/memory/{service,routes}.ts` + `recall.ts`; `apps/gateway/src/lib/retrieval.ts`; `apps/gateway/src/modules/runs/runner.ts`; `apps/gateway/src/modules/chat/{service,progress}.ts`; `apps/gateway/src/config.ts`; `apps/gateway/src/testing/stubs.ts`; `packages/contracts/src/{entities,api-schemas,events}.ts` + tes + OpenAPI; desktop `memory/MemorySection.tsx`, `progress/UsedSection.tsx`, `api/gateway.ts`, `copy.ts`; Android `MemoryApi.kt`, `MemoryRepository.kt`, `MemoryScreen.kt`, `MemoryViewModels.kt`, `ProgressSheet.kt`, `ProgressDto.kt`, `strings_memory.xml`; `apps/gateway/src/cli/eval-memory*.ts`; `docs/API_CONTRACT.md`, `docs/BACKLOG.md`, `CHANGELOG.md`.
- Kriteria terima: (a) total karakter memori aktif ≤ anggaran → bagian memori sama persis dengan sekarang dan tes `memory.integration.test.ts:122` tetap lulus tanpa diubah; (b) di atas anggaran → panjang bagian ≤ anggaran, semua yang tersemat (sampai separuh anggaran) ada, sisanya menurut peringkat; (c) `context.used.memory.read` = jumlah butir yang disuntik dan `items` cocok; (d) satu pembacaan memori per run; (e) tidak ada permintaan ke 9Router dari jalur ini.
- Verifikasi: `pnpm --filter @aios/contracts test && pnpm --filter @aios/gateway test && pnpm --filter @aios/desktop test && pnpm typecheck && pnpm lint`; Android `cd apps/android && ./gradlew testDebugUnitTest`; `pnpm --filter @aios/gateway eval:memory`.

### Slice 2 — Embedding dan recall hibrida untuk memori

- Prasyarat untuk **menyalakan** (bukan untuk merilis): satu koneksi embedding di 9Router (keputusan 1). Dirilis mati.
- Berkas: migrasi `embeddings`; `apps/gateway/src/modules/embeddings/{client,repo,jobs}.ts`; `memory/recall.ts`; `config.ts`; `main.ts`; `infra/compose/gateway.env.example`; dokumen.
- Kriteria terima: (a) `EMBEDDING_MODEL` kosong → perilaku identik slice 1, nol permintaan `/embeddings`; (b) dengan embedder palsu, kueri parafrase di fixture menemukan fakta yang tidak cocok kata; (c) embedding gagal/lambat → run selesai, `mode = 'lexical'`, tambahan waktu ≤ `EMBEDDING_QUERY_TIMEOUT_MS`; (d) backfill mengisi semua memori lama dan memperbarui yang teksnya berubah; (e) memori yang cocok `findSecret` tidak pernah dikirim; (f) `/readyz` tidak berubah.
- Verifikasi: `pnpm --filter @aios/gateway test`; `pnpm typecheck && pnpm lint`; dengan model sungguhan: `pnpm --filter @aios/gateway eval:memory` dan catat recall@k leksikal vs hibrida di `docs/BACKLOG.md`.

### Slice 3 — Ekstraksi fakta menjadi usulan memori

- Berkas: migrasi (`memories.source*`, `memory_proposals`); `apps/gateway/src/modules/memory/{extractor,proposal-service,jobs}.ts` + rute; `runs/runner.ts` (kait `run.completed`); `chat/service.ts` (`extract`); `config.ts`; `main.ts`; kontrak (skema usulan, endpoint, `notification.topic`); desktop `memory/*`, `app/userEvents.ts`, `api/*`, `copy.ts`; Android layar Memori; `e2e/tests/memory.spec.ts`, `e2e/harness/fakes.ts`; dokumen.
- Kriteria terima: (a) mode `off` → tidak ada pekerjaan dan tidak ada panggilan model; (b) `propose` → fakta dari pesan pemilik menjadi usulan `pending` dengan asal; setuju membuat memori `source = 'extracted'`; (c) `auto` → tersimpan dengan asal terlihat dan Urungkan mengembalikan keadaan semula; (d) fixture injeksi dan rahasia menghasilkan nol usulan; (e) fakta tanpa `evidence` di teks pemilik dibuang; (f) duplikat dan yang pernah ditolak tidak diusulkan lagi; (g) percakapan project/ruang/tim/jadwal tidak pernah diekstrak; (h) batas harian dan batas `pending` dihormati; (i) kegagalan ekstraksi tidak mengubah hasil run.
- Verifikasi: `pnpm --filter @aios/contracts test && pnpm --filter @aios/gateway test && pnpm --filter @aios/desktop test && pnpm --filter @aios/e2e e2e`; Android `./gradlew testDebugUnitTest`; `pnpm typecheck && pnpm lint`.

### Slice 4 — Ruang pengetahuan hibrida

- Prasyarat: slice 2 dan keputusan 4.
- Berkas: `apps/gateway/src/modules/spaces/service.ts`; `modules/embeddings/*` (`chunk_id`, cache); `config.ts`; tes ruang; dokumen.
- Kriteria terima: (a) `SPACES_VECTOR=false` → `contextFor` identik dengan sekarang (tes `spaces.integration.test.ts:165-193` lulus tanpa diubah); (b) nyala → pertanyaan parafrase menemukan potongan yang tidak cocok kata; format sitasi tetap; (c) dokumen baru langsung bisa dicari leksikal sebelum ter-embed; (d) menghapus dokumen/ruang menghapus vektornya; (e) cache tidak melewati batas memori.
- Verifikasi: `pnpm --filter @aios/gateway test`; `pnpm typecheck && pnpm lint`.

### Slice 5 (opsional) — Pencarian riwayat hibrida

Meng-embed pesan chat dan laporan riset untuk `GET /search`. Hanya bila slice 2 terbukti berguna di evaluasi; volume dan privasinya (semua pesan keluar ke penyedia embedding) jauh lebih besar. Dicatat di `docs/BACKLOG.md`, tidak dirinci di sini.

## 7. Keputusan terbuka untuk pemilik

| # | Keputusan | Saran bawaan |
| --- | --- | --- |
| 1 | **Sumber embedding**: tidak ada; penyedia hosted lewat 9Router; atau server lokal di VPS yang didaftarkan sebagai `selfhosted-embedding` | Rilis slice 1 tanpa embedding. Untuk slice 2: penyedia hosted yang sudah dipercaya pemilik, model multibahasa, dimensi ≤ 768. Pilih lokal bila teks memori tidak boleh keluar ke penyedia baru; ukur dulu latensinya di VPS |
| 2 | **Mode ekstraksi**: usulan yang dikonfirmasi, atau simpan otomatis dengan Urungkan | `propose`. Sejalan dengan ide di `docs/BACKLOG.md:486`; `auto` baru setelah presisi evaluasi diketahui |
| 3 | **Cakupan ekstraksi**: chat umum saja, atau juga percakapan project dan ruang | Chat umum saja |
| 4 | **Bolehkah potongan dokumen ruang dikirim ke penyedia embedding** | Tidak (`SPACES_VECTOR=false`) sampai embedding lokal tersedia atau pemilik menyetujui penyedianya |
| 5 | **Memori internal Hermes** tetap berjalan berdampingan (tidak terlihat, tidak bisa diurungkan dari aplikasi) atau dimatikan agar hanya memori gateway yang berlaku | Biarkan apa adanya di rilis ini; tinjau setelah ekstraksi berjalan, karena dua sumber memori bisa saling bertentangan |

## Lampiran — batas investigasi

- Tidak ada perubahan di `/home/ubuntu/personal-ai-os`, `/srv`, atau container `aios-*`. Yang dibaca dari produksi: nama model dan URL 9Router di `gateway.env` (tanpa nilai rahasia), label compose container gateway, dan `PG_VERSION` image `postgres:16`.
- 9Router: 5 GET dan 2 POST `/v1/embeddings`; basis data dan berkas terpasangnya hanya dibaca. Efek samping POST kedua ada di 2.3.
- Tidak diukur: jumlah baris produksi, latensi dan dimensi model embedding apa pun, latensi embedding lokal, mutu recall leksikal vs hibrida (itu tugas `pnpm eval:memory`).
- Angka token memakai taksiran 4 karakter per token; repo belum punya penghitung token.
