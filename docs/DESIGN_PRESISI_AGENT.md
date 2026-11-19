# Desain: presisi agent coding (omp lewat worker)

Status: **investigasi selesai** (fase A) dan **tingkat 1 terimplementasi** (fase B, bagian 7). Disusun 2026-11-17 di branch `feat/presisi-agent` dari `main` (e0a8bb8, rilis v1.1.5). Semua rujukan `berkas:baris` dibaca di commit itu. Perilaku omp diamati dengan omp 18.12.6 sungguhan di host ini (arm64); PC pemilik memakai omp 18.13.2 (docs/VERIFICATION.md:260). Yang tidak teramati langsung ditandai **[INFERENSI]**.

## 0. Ringkasan

- **Masalah.** Di chat project (mesin omp lewat worker) agent kadang menganalisis dangkal, mengubah kode yang tidak perlu, dan mengubah tanda tangan fungsi (`(data)` → `({ data })`) tanpa memperbarui pemanggilnya.
- **Direproduksi.** Fixture TypeScript kecil, run coding sungguhan lewat worker + omp + 9Router (`coding-main`, model hulu teramati `gpt-6-luna`), prompt persis dari gateway produksi. Dari tiga run yang setia dengan lingkungan produksi, **dua menghasilkan refactor rusak** (0 dari 4 dan 3 dari 4 pemakai diperbarui) dan **tidak satu pun berhasil menjalankan typecheck** (`sh: 1: tsc: not found`). Bagian 3.
- **Akar masalah** (bagian 4), urut dampak:
  1. **Worktree run tidak punya dependensi.** `node_modules` tidak ikut git, setup worktree bawaan kosong, tautan `node_modules` sengaja mati. Akibatnya typecheck/tes gagal dijalankan dan **LSP omp yang "nyala bawaan" tidak pernah menemukan server bahasa** ("No language server found"). Agent berhenti tanpa verifikasi.
  2. **Tidak ada protokol perubahan tanda tangan** di prompt AIOS. Aturan "minimal diff" dan "verifikasi" ada tetapi umum; tidak ada perintah mencari semua pemakai (termasuk alias/re-export) sebelum mengubah tanda tangan.
  3. **Prompt bawaan omp mendorong ke arah sebaliknya**: "Delete dead weight", "Default clean cutover … remove obsolete code/comments/aliases", "Existing … tests: MUST delete", dan delegasi ke subagent yang **tidak menerima prompt AIOS**.
- **Rekomendasi tingkat 1 (dikerjakan di branch ini):** blok "aturan kerja kode" di role `project` (pahami dulu, diff minimal, protokol tanda tangan, verifikasi wajib, tanpa subagent untuk menulis, periksa diff) dan catatan worker "Dependensi worktree" yang membuat agent menjalankan instal dependensi (lewat approval) sebelum typecheck.
- **Hasil.** Dengan prompt akhir, 3 dari 3 run sungguhan memperbarui keempat pemakai, menjalankan typecheck sampai lulus, dan tidak menyentuh berkas lain; di satu run typecheck itulah yang menangkap alias yang terlewat, lalu agent memperbaikinya sendiri (bagian 7). Sebelumnya 2 dari 3 run menyerahkan refactor rusak dan 0 dari 3 menjalankan typecheck.
- **Di luar kendali AIOS:** kualitas model hulu combo `coding-main`, server bahasa TypeScript yang tidak ada di PC pemilik, dan isi prompt bawaan omp.
- **Catatan sesudahnya (feat/branch-aktif):** run coding chat project kini bawaannya mode `in_place` (langsung di folder project pada branch aktif). Di mode itu `node_modules` project sudah ada, jadi akar masalah #1 tidak berlaku: catatan "Dependensi worktree" tidak muncul, typecheck/tes langsung jalan, dan LSP omp menemukan server bahasa bila ada di `node_modules/.bin` project atau PATH. Temuan di dokumen ini tetap berlaku untuk mode worktree (kartu kanban, armada, tim, jadwal, atau pilihan eksplisit) dan tidak diubah.

## 1. Masalah

Laporan pemilik, untuk run coding di chat project:

1. Analisis kode kadang meleset; agent tidak memahami konteks yang cukup.
2. Saat diminta mengubah kode, agent ikut mengubah kode yang tidak perlu.
3. Kasus nyata: parameter fungsi diubah dari `(data)` ke `({ data })` tanpa memperbarui pemanggil. Kelas bug ini (tanda tangan berubah, pemanggil/import/tipe tertinggal) yang harus berhenti.

## 2. Jalur run coding hari ini (apa yang diterima agent)

### 2.1 Pesan sistem

| Fakta | Bukti |
| --- | --- |
| Gateway menyusun pesan sistem run coding: bundel role + konteks project + aturan saran lanjutan (+ mode rencana, memori, aturan project bila ada) | `apps/gateway/src/modules/runs/runner.ts:314-361` |
| Bundel = aturan perilaku + isi role + skill inti (ditempel utuh) + skill khusus + indeks "Skill tersedia" | `packages/roles/src/bundle.ts:109-191` |
| Skill inti untuk semua role: `scope-guard`, `read-context-first`, `plan-before-edit`, `verify-before-done`, `minimal-diff`, `rich-answers`, `propose-skill` | `packages/roles/src/schema.ts:9-17` |
| Role `project`: engine omp, model `coding-main`, skill tambahan `find-skills`, `plan-progress` | `packages/roles/roles/project.md:1-21` |
| Konteks project: nama + stack, "baca dulu berkas yang relevan (struktur folder, README, package.json, kode terkait)" | `apps/gateway/src/modules/runs/runner.ts:229-235` |
| Prompt pengguna hanya ditambah isi tautan/hasil cari web bila ada; tidak ada peta repo | `apps/gateway/src/modules/runs/runner.ts:465-475`, `apps/gateway/src/modules/chat/service.ts:149-175` |
| Worker menambah instruksi commit, tautan, browser, tool gateway, konektor | `apps/worker/src/runs/coordinator.ts:398-404` |
| Adapter menulis semuanya ke `system.md` dan memakai `--append-system-prompt`; omp menaruhnya di akhir prompt bawaannya di bawah "## User Instructions … supersede conflicting guidance above" | `packages/adapters/src/omp.ts:210,255-256`; tangkapan prompt (bagian 3) |

`run.start` yang ditangkap dari gateway sungguhan (tes integrasi sementara, Postgres sekali pakai) untuk pesan "ubah parameter render menjadi ({ data })" di project TypeScript: role `project`, model `coding-main`, `skillIds: []` (router tidak menawarkan skill tambahan untuk kalimat ini), pesan sistem 10.794 karakter.

### 2.2 Apa kata prompt soal scope, verifikasi, dan refactor

Yang **ada** (semua umum):

- Role `project` "Cara kerja": "Ikuti konvensi yang sudah ada; ubah sesedikit mungkin." dan "Jalankan typecheck, lint, dan tes yang terkait sebelum menyatakan selesai." (`packages/roles/roles/project.md:34-35`); DoD "tanpa menyentuh hal lain" (`:39`).
- `minimal-diff`: "Ubah hanya yang dibutuhkan permintaan; tanpa refactor, rename, atau format ulang yang tidak diminta" dan "Sebelum selesai, baca ulang diff" (`packages/roles/skills/minimal-diff/SKILL.md:6,10`).
- `scope-guard`: "Jangan mengubah file atau topik yang tidak disebut pengguna." (`packages/roles/skills/scope-guard/SKILL.md:9`). Kalimat ini justru bertentangan dengan refactor yang benar: memperbarui pemanggil berarti mengubah berkas yang tidak disebut.
- `verify-before-done`: "jalankan typecheck, lint, dan tes yang terkait … bila ada yang gagal atau tidak dijalankan, katakan dengan jelas" (`packages/roles/skills/verify-before-done/SKILL.md:6-7`).
- `read-context-first`: "baca AGENTS.md, struktur folder, dan file yang terkait" (`packages/roles/skills/read-context-first/SKILL.md:6`).

Yang **tidak ada**: perintah mencari semua referensi sebelum mengubah tanda tangan, memperbarui pemanggil/import/tipe/tes di run yang sama, larangan mengubah tanda tangan bila itu tidak mungkin, dan cara memverifikasi bila dependensi belum ada.

Bagian AIOS ±10,8 ribu karakter; sekitar setengahnya (`rich-answers`, `propose-skill`, `find-skills`, `plan-progress`, saran lanjutan) tidak berkaitan dengan presisi kode. Aturan scope/verifikasi berupa beberapa butir di tengahnya.

### 2.3 Prompt bawaan omp (yang mendahului prompt AIOS)

Ditangkap dari permintaan pertama omp ke model tiruan (±9,9 ribu karakter sebelum `<project-context>`). Butir yang relevan:

| Isi prompt bawaan omp | Dampak |
| --- | --- |
| "Delete dead weight" | mendorong menghapus kode yang tidak diminta |
| "Default clean cutover: migrate every caller; remove obsolete code/comments/aliases/re-exports/deprecated paths" | "migrate every caller" membantu, tetapi "remove … comments/aliases" mendorong scope creep |
| "Existing wording/implementation/incidental-behavior tests: MUST delete, NEVER re-pin regardless of author" | mendorong menghapus tes milik project |
| "Map unknown code via `task`" (delegasi ke subagent) | subagent omp **tidak** menerima `--append-system-prompt` maupun AGENTS.md (dokumentasi omp "System Prompt Customization", tabel "Inputs by session type"), jadi aturan AIOS hilang di subagent |
| "Exported symbol changes: MUST run `lsp` references first" dan "Language server available: MUST use `lsp`" | benar, tetapi tool `lsp` tidak punya server (bagian 2.4) |
| "Before yielding, MUST verify significant behavioral changes" | benar, tetapi typecheck tidak bisa jalan (bagian 2.5) |

Header omp di atas teks AIOS ("authoritative and supersede conflicting guidance above") memberi AIOS hak menimpa, tetapi prompt AIOS tidak pernah menyebut butir mana yang ditimpa.

### 2.4 LSP

| Fakta | Bukti |
| --- | --- |
| `StartRunInput.lsp` (hanya omp) | `packages/adapters/src/types.ts:50-51` |
| Worker mengisi `lsp` dari setup project, bawaan `true` | `apps/worker/src/runs/coordinator.ts:412`, `apps/worker/src/runs/setup.ts:13` |
| `lsp: true` → tanpa `--no-lsp`, overlay `lsp.requestTimeout: 60` (server dingin ±20-25 detik, batas bawaan 20 detik → "Operation aborted") | `packages/adapters/src/omp.ts:65-66,229-233,253`; `docs/VERIFICATION.md:265` |
| omp hanya menjalankan server bahasa yang ditemukan di `node_modules/.bin` folder kerja atau di PATH | `docs/VERIFICATION.md:269`; `docs/SECURITY_OPS.md:26`; dokumentasi omp "LSP configuration" (Auto-detection) |
| Worktree run tidak membawa `node_modules`; setup bawaan kosong; tautan `node_modules` bawaannya mati karena memberi agent akses tulis ke `node_modules` asli | `apps/worker/src/runs/coordinator.ts:447-477`; `apps/worker/src/preview/nodemodules.ts:5-30`; `docs/SECURITY_OPS.md:25` |
| BACKLOG menandai LSP "Sudah", dengan catatan "server bahasa tidak dipasang otomatis" | `docs/BACKLOG.md:714` |

**Teramati** (omp 18.12.6, model tiruan memanggil tool `lsp` setelah menulis tanda tangan baru):

- Setup bawaan (LSP nyala, tanpa `node_modules` di worktree): `lsp references` → `No language server found for this action`; `lsp diagnostics` → `✘ src/pages/home.ts: No language server found`. Hasil `write` tanpa diagnostik.
- Dengan `node_modules` yang memuat `typescript` + `typescript-language-server` (tautan node_modules dinyalakan): `references` → `Found 6 reference(s)` (definisi, 2 import, 3 pemanggilan di `cart.ts` dan `home.ts`); `diagnostics src/pages/home.ts` → 2 galat TS2345 tepat di dua pemanggilan lama. Server dingin selesai jauh di bawah 60 detik di host ini.

Jadi LSP **berfungsi** bila server ada, tetapi di jalur produksi bawaan ia praktis mati untuk project TypeScript. Bahkan setelah dependensi dipasang, `typescript-language-server` jarang ada di `devDependencies` project biasa. **Teramati:** dengan `typescript-language-server` + `typescript` di PATH (meniru instal global) dan worktree **tanpa** `node_modules`, `lsp references` menemukan 10 referensi termasuk alias `renderList` di `promo.ts` lewat re-ekspor, dan `diagnostics` menunjuk dua pemanggilan lama. Apakah PC pemilik punya server itu di PATH tidak bisa diperiksa dari sini **[INFERENSI: kemungkinan tidak]**.

### 2.5 Verifikasi dan tinjauan

| Fakta | Bukti |
| --- | --- |
| omp `--approval-mode always-ask`: setiap perintah shell (termasuk `npm run typecheck`) meminta izin pemilik kecuali ada aturan "selalu" yang cocok persis | `packages/adapters/src/omp.ts:240-242`; `apps/worker/src/runs/rules.ts:32-36` |
| Tidak ada pemeriksaan otomatis setelah run: worker hanya membuat checkpoint dan `diff.updated` per langkah tool | `apps/worker/src/runs/coordinator.ts:543-556,560-585` |
| Tinjauan: daftar berkas + diff + checkpoint; Terima = satu commit di branch run (merge opsional fast-forward) | `apps/worker/src/runs/review.ts:239-262`; `apps/desktop/src/review/ReviewView.tsx` |
| "Pendapat kedua" (`POST /review/opinion`) hanya bila pemilik menekan tombol | `docs/API_CONTRACT.md:59` |
| Pesan commit ditulis agent (`Commit: …`) | `apps/worker/src/runs/commit-message.ts:2-5` |

Di worktree tanpa `node_modules`, `npm run typecheck` gagal `tsc: not found` (exit 127). Tidak ada apa pun yang memberi tahu agent bahwa dependensi perlu dipasang dulu.

### 2.6 Model

| Fakta | Bukti |
| --- | --- |
| Model run coding = pilihan pemilik di composer, atau combo milik role (`coding-main`) | `apps/gateway/src/modules/runs/runner.ts:604-605` |
| `fallback_model` role dihapus (fix/project-inti): nilainya (`coding-cheap`, `general-cheap`) tidak pernah dipakai run dan combo itu tidak ada di 9Router; fallback antar-penyedia dikerjakan combo 9Router | `packages/roles/roles/*.md`, `GET /roles` tanpa `fallbackModel` |
| 9Router lokal (`GET /v1/models`, tanpa kunci): 43 model; combo hanya `coding-main` (`coding-cheap` tidak ada) | diamati 2026-11-17 |
| Model hulu yang menjawab `coding-main`: `gpt-6-luna` (field `model` di stream) | diamati di 7 run sungguhan |
| `models.yml` per run: bawaan `reasoning: false`, `contextWindow: 128000`, `maxTokens: 8192`; bisa diatur lewat `AIOS_OMP_REASONING`, `AIOS_OMP_CONTEXT_WINDOW`, `AIOS_OMP_MAX_TOKENS` di worker (fix/project-inti) | `packages/adapters/src/omp.ts` (`OMP_MODEL_DEFAULTS`), `apps/worker/src/runs/omp-path.ts` |
| `reasoning: true` lewat proxy pencatat ke 9Router lokal: omp hanya menambah `reasoning_effort: "high"`; `coding-main` (katalog 9Router: hulu `gpt-6-luna`, `reasoning: false`) tidak mengirim `reasoning_content` dan jawaban soal uji sama; `zrouter/deepseek-v4.1-flash` juga tanpa `reasoning_content`; `zrouter/gpt-5.6-luna` mengirim `reasoning_content` di kedua setelan | diamati 2026-11-19 |

`reasoning: false` tetap bawaan karena combo yang dipakai (`coding-main`) tidak menunjukkan perbedaan; untuk combo dengan model penalaran, pemilik bisa menyalakannya per worker **[INFERENSI: dampak pada kedalaman analisis tugas nyata belum diukur]**. `maxTokens: 8192` tidak membatasi di run uji (keluaran 360–1.205 token per run), tetapi bisa memotong `write` berkas besar **[INFERENSI]**.

### 2.7 Konteks

- omp memuat `AGENTS.md` dari worktree otomatis ke `<repo-rules>` dan berpesan "NEVER grep/glob for AGENTS.md" (teramati dengan penanda di fixture). Role AIOS tetap menyuruh "Baca AGENTS.md" (`packages/roles/roles/project.md:31`); di fixture tanpa AGENTS.md agent membuang satu langkah membaca berkas yang tidak ada (teramati di semua run sungguhan).
- Tidak ada peta repo di prompt; agent mulai dari `glob .` dan membaca berkas sendiri. Riwayat percakapan project ikut dikirim (`apps/gateway/src/modules/runs/runner.ts:363-367`).

## 3. Reproduksi

**Fixture** (sementara, dihapus setelah bukti): `src/render.ts` mengekspor `function render(data: Item[])`; dipanggil 3 kali di 2 berkas (`src/pages/home.ts` ×2, `src/pages/cart.ts` ×1); `src/index.ts` me-re-ekspor `render as renderList` yang dipanggil di `src/widgets/promo.ts`; umpan scope creep (`var`, `==`, `src/util/format.ts`); `tsconfig.json` strict; skrip `typecheck: tsc --noEmit`. Folder project punya `node_modules` (diabaikan git) seperti PC pemilik; worktree run tidak.

**Jalur:** worker sungguhan (`startWorker`) + omp terpasang + gateway tiruan yang meneruskan `/llm/v1/*` ke 9Router lokal tanpa kunci (seperti gateway produksi). Semua izin dijawab "izinkan" (pemilik yang mengizinkan semua). PATH dibersihkan dari `node_modules/.bin` milik AIOS supaya `tsc` tidak tersedia secara kebetulan. Pesan: "ubah parameter render menjadi ({ data })".

**Sebelum** (pesan sistem persis dari gateway `main`, setup worktree bawaan):

| Run | Pemakai diperbarui (dari 4) | Berkas lain tersentuh | Typecheck oleh agent | `tsc --noEmit` hasil akhir | Klaim agent |
| --- | --- | --- | --- | --- | --- |
| sebelum-2 | 3 (alias `renderList` di `promo.ts` terlewat) | tidak | gagal: `tsc: not found` | exit 2 (1 galat) | "pemanggilan … sudah disesuaikan"; typecheck "tidak berjalan" |
| sebelum-3 | 0 (hanya `render.ts`) | tidak | gagal: `tsc: not found` | exit 2 (4 galat) | "Typecheck belum berjalan" |
| sebelum-4 | 4 | tidak | gagal: `tsc: not found` | exit 0 | "pencarian mengonfirmasi"; typecheck tidak berjalan |

Run pertama (sebelum-1) memakai fixture tanpa alias dan tanpa membersihkan PATH: `tsc` milik AIOS terjangkau lewat PATH vitest, typecheck agent lulus, dan semua pemanggil diperbarui. Run itu tidak setia dengan PC pemilik dan tidak dihitung.

Pola: agent jujur bahwa typecheck tidak berjalan, tetapi tetap menyerahkan refactor yang rusak, dan tidak pernah mencoba memasang dependensi. Tidak ada scope creep pada fixture ini (umpan tidak disentuh), jadi keluhan scope creep tidak tereproduksi di sini.

## 4. Akar masalah

1. **Verifikasi mustahil di worktree bawaan.** Tanpa `node_modules`, typecheck/tes gagal dan LSP tidak punya server (2.4, 2.5). Semua aturan "jalankan typecheck" (role, skill, prompt omp) berakhir di `tsc: not found`, dan agent berhenti di sana. Ini satu-satunya lapis yang bisa menangkap refactor rusak tanpa bergantung pada ketelitian model, dan ia mati.
2. **Prompt AIOS tidak punya protokol tanda tangan** (2.2). "Ubah sesedikit mungkin" bahkan bisa dibaca sebagai alasan tidak menyentuh pemanggil; `scope-guard` melarang mengubah berkas yang tidak disebut.
3. **Prompt bawaan omp mendorong scope creep dan delegasi tanpa aturan AIOS** (2.3), dan prompt AIOS tidak menimpanya secara eksplisit.
4. **Model** (2.6): perilaku berbeda antar-run dengan prompt sama (0, 3, 4 dari 4 pemanggil). Ini di luar kendali kode AIOS; yang bisa dilakukan AIOS adalah membuat verifikasi mungkin dan protokolnya eksplisit.

## 5. Rekomendasi bertingkat

### Tingkat 1: kode AIOS, kecil, dikerjakan di branch ini

1. **Blok "aturan kerja kode" di role `project`** (bagian "Cara kerja" dan DoD), pendek dan imperatif: mengalahkan aturan bawaan mesin yang bertentangan; pahami dulu (baca berkas + pemanggil); diff minimal (tanpa format ulang/rename/hapus kode, komentar, tes yang tidak diminta); **protokol tanda tangan** (cari semua pemakai dengan `lsp` references bila ada DAN grep nama + alias; perbarui pemanggil/import/tipe/mock/tes di run yang sama; bila tidak mungkin, jangan ubah tanda tangan); subagent hanya membaca; verifikasi wajib dengan laporan perintah + hasil; baca ulang diff. AGENTS.md disebut "sudah ada di konteks" (omp memuatnya) alih-alih "baca".
2. **Catatan worker "Dependensi worktree"**: bila worktree punya `package.json` tetapi belum punya `node_modules` (dan bukan mode rencana), pesan sistem diberi satu paragraf: "dependensi belum terpasang" bukan alasan melewati verifikasi; jalankan perintah instal lewat tool bash (izin pemilik diminta otomatis), lalu typecheck dan tes; hanya izin ditolak atau instal gagal yang boleh berakhir tanpa verifikasi. Perintahnya sesuai lockfile (`pnpm install --frozen-lockfile`, `yarn/bun install --frozen-lockfile`, `npm ci`); tanpa lockfile dipakai varian yang tidak membuat lockfile baru (`npm install --no-package-lock`, `pnpm install --lockfile=false`, `yarn install --no-lockfile`, `bun install --no-save`). Perintah tetap lewat approval; kebijakan keamanan tidak berubah.

### Tingkat 2: konfigurasi pemilik (tanpa kode)

1. Isi **Setup worktree** per project kode dengan perintah instal (mis. `pnpm install --frozen-lockfile --prefer-offline`), supaya worktree selalu siap typecheck tanpa izin tambahan per run. Atau nyalakan tautan `node_modules` bila risikonya diterima (`docs/SECURITY_OPS.md:25`).
2. Pasang `typescript-language-server` + `typescript` di PATH PC pemilik (`npm i -g typescript typescript-language-server`) supaya LSP omp aktif untuk project TypeScript (referensi lintas re-ekspor dan diagnostik), bahkan sebelum dependensi worktree dipasang (teramati, 2.4 dan run `sesudah-lsp` di bagian 7). Aturan "selalu izinkan" untuk perintah instal dan typecheck project mengurangi gangguan izin.
3. Bila hasil masih lemah, pilih model lain untuk combo `coding-main` di 9Router, atau pilih model langsung di composer; buat combo `coding-cheap` atau hapus dari role (tidak dipakai saat run).

### Tingkat 3: fitur berikutnya (dicatat, tidak dikerjakan)

1. **Perintah verifikasi milik pemilik di Setup worktree** yang dijalankan worker setelah agent selesai; hasilnya tampil di tinjauan dan dikirim balik ke agent bila gagal. Lapis ini tidak bergantung pada kepatuhan model.
2. `reasoning` per model di `models.yml` (sekarang selalu `false`), setelah dukungan combo 9Router diverifikasi.
3. Tanda "hanya format" per berkas di tinjauan (hunk yang berbeda hanya spasi), bila scope creep jenis format ulang teramati.

## 6. Yang TIDAK dilakukan

- **Tidak menyalakan tautan `node_modules` secara bawaan** dan tidak menambahkan `node_modules/.bin` folder project ke PATH omp: keduanya membuat isi repo/`node_modules` menentukan apa yang dijalankan otomatis atau memberi akses tulis ke luar worktree, bertentangan dengan `docs/SECURITY_OPS.md:25-26`.
- **Tidak menambah penanda "berkas tidak disebut permintaan" di tinjauan.** Refactor yang benar menyentuh berkas pemanggil yang tidak pernah disebut (di sebelum-4: 3 dari 4 berkas); penanda itu akan selalu menyala pada perubahan yang benar dan melatih pemilik mengabaikannya. Laporan akhir agent kini wajib menyebut alasan tiap berkas berubah.
- **Tidak menjalankan typecheck otomatis dari worker** (tingkat 3): butuh perintah yang dipilih pemilik dan dependensi terpasang; menjalankan skrip repo secara otomatis melanggar aturan "isi repo tidak menentukan apa yang dijalankan".
- **Tidak mengubah skill inti** (`scope-guard`, `minimal-diff`, `verify-before-done`): dipakai juga oleh role Umum dan Riset di Hermes; aturan khusus kode cukup di role `project`.
- **Tidak mengganti prompt bawaan omp** (`--system-prompt`): kehilangan tool policy omp yang berguna dan rapuh terhadap versi omp; cukup ditimpa eksplisit lewat teks yang ditambahkan.
- **Tidak mengubah model atau combo 9Router** (di luar repo, bukan wewenang branch ini).
- **Tidak menyuruh agent memanggil `lsp reload` setelah instal**: aksi itu meminta izin tulis (teramati sebagai izin "Action: reload") dan tidak berguna bila `typescript-language-server` tidak ada di dependensi project.

## 7. Implementasi dan bukti sesudah

**Perubahan.** `packages/roles/roles/project.md` (bagian "Cara kerja", DoD, format output); `apps/worker/src/runs/dependencies.ts` (catatan "Dependensi worktree", memakai `packageManagerOf` yang kini diekspor dari `apps/worker/src/preview/devcommand.ts`); `apps/worker/src/runs/coordinator.ts` (catatan ditambahkan ke pesan sistem, kecuali mode rencana). Tanpa perubahan kontrak, tanpa dependensi baru. Tes: `apps/worker/src/runs/dependencies.test.ts`, tiga kasus baru di `apps/worker/src/runs/coordinator.test.ts`.

**Prompt sampai ke omp.** Pesan sistem permintaan pertama omp ke model (ditangkap di proxy) memuat blok "Ubah tanda tangan …" dan "# Dependensi worktree" dengan perintah `npm install --no-package-lock`, di bawah header omp "## User Instructions" (24.413 karakter, sebelumnya 22.755).

**Run sungguhan** (jalur dan fixture bagian 3; semua izin diizinkan; model hulu `gpt-6-luna` di setiap run):

| Run | Prompt | Pemakai diperbarui (dari 4) | Berkas lain | Typecheck oleh agent | `tsc --noEmit` akhir |
| --- | --- | --- | --- | --- | --- |
| sebelum-2 | `main` | 3 | – | `tsc: not found` | exit 2 |
| sebelum-3 | `main` | 0 | – | `tsc: not found` | exit 2 |
| sebelum-4 | `main` | 4 | – | `tsc: not found` | exit 0 |
| sesudah-1 | akhir | 4 | – | instal → typecheck **gagal** (alias `renderList` terlewat) → diperbaiki → lulus | exit 0 |
| sesudah-2 | akhir | 4 | – | instal → lulus | exit 0 |
| sesudah-3 | akhir | 4 | – | instal → lulus; agent juga membaca `git diff` sebelum selesai | exit 0 |
| sesudah-lsp | akhir, server TS di PATH | 4 (`lsp references` sebelum edit: 10 referensi termasuk alias) | – | instal → lulus | exit 0 |

"Berkas lain" = berkas di luar `render.ts` dan ketiga pemanggilnya; umpan (`var`, `==`, `src/util/format.ts`) tidak disentuh di run mana pun.

**Iterasi yang ditolak** (dicatat apa adanya): versi pertama catatan berbunyi "minta izin menjalankan …"; di dua run agent memperbarui keempat pemakai tetapi hanya *menulis* bahwa ia butuh izin `npm install`, tanpa menjalankannya (run ketiga tidak selesai dalam 20 menit dan dihentikan; penyebabnya tidak diperiksa). Versi kedua ("jalankan … dengan tool bash") membuat dua dari tiga run menginstal dan typecheck menangkap alias yang terlewat, tetapi `npm install` tanpa lockfile menambah `package-lock.json` ke diff (perubahan yang tidak diminta, akibat instruksi itu sendiri), dan satu run tetap melewatinya. Versi akhir menyebut "dependensi belum terpasang bukan alasan melewati verifikasi" dan memakai perintah yang tidak membuat lockfile baru.

**Batas bukti.** Satu fixture kecil, satu model hulu, tiga sampai empat run per kondisi; ini menunjukkan arah, bukan tingkat keberhasilan di repo besar. Scope creep yang dilaporkan pemilik tidak tereproduksi di fixture ini, jadi efek aturan "diff minimal" belum terukur.
