# Agent & Skill Spec — Personal AI OS

Aplikasi punya **dua agent tetap**. Yang membedakannya hanya ada tidaknya project, bukan isi pesan. Kemampuan khusus (tampilan, API, debugging, review, riset, menulis) datang dari **skill** yang dimuat per permintaan. Tidak ada router model, tidak ada pemilihan role oleh pengguna, dan tidak ada `@role` (keputusan pemilik, Fase 48: role dihapus, diganti banyak skill).

## Agent (3 file, 2 dipilih per pesan)

| Agent | Grup | Mesin | Dipakai untuk | Skill milik agent |
| --- | --- | --- | --- | --- |
| `general` | Umum | Hermes (server) | Chat umum di tab Chat dan semua chat Android: pertanyaan apa pun, menulis dan menjelaskan kode di chat, tidak terikat folder project | answer-first, clarify-once, find-skills |
| `project` | Coding | omp (worker Windows) | Chat per folder project di tab Project dan run kartu kanban: membaca, mencari, menjawab, dan mengubah kode di folder project itu (worktree run) | find-skills, plan-progress (selain skill inti; plan-progress = rencana dengan tool todo untuk tugas 3 langkah atau lebih, hanya untuk mesin yang punya tool todo) |
| `researcher` | Umum | Research engine + Hermes | Hanya fitur Riset dan jadwal riset; tidak pernah dipilih untuk pesan chat | source-verification, citation, fact-vs-opinion |

**Aturan pemilihan agent** (`pickAgent`, `packages/roles/src/agents.ts`; tanpa model dan tanpa jaringan): `surface = windows` dan ada project → `project`; selain itu → `general`. Android dengan atau tanpa project tetap `general` karena tidak punya akses ke folder.

## Paket skill: skill spesialis dipilih dari kata kunci

`selectSkills` memeriksa teks pesan terhadap pola kata kunci (`SKILL_PACKS`) dan memilih skill dari paket yang cocok, berurutan, tanpa duplikat. Paket `frontend` dan `backend` hanya untuk agent `project`.

| Paket | Skill | Contoh kata kunci |
| --- | --- | --- |
| `debugging` | reproduce-first, diagnosing-bugs | error, crash, bug, gagal, stack trace |
| `frontend` | ui-baseline, a11y-check, ui-states, react-practices | tampilan, komponen, tombol, css, react |
| `backend` | api-design, input-validation, error-handling, safe-migrations | endpoint, database, migrasi, auth |
| `review` | code-review, security-basics | review, keamanan, audit, diff |
| `research` | source-verification, citation, fact-vs-opinion | riset, bandingkan, sumber, terbaru |
| `writing` | stop-slop, script-structure, audience-voice | naskah, caption, email, artikel |

Pola sengaja lebar: skill tambahan yang tidak perlu hanya memakai token, sedangkan skill yang hilang menurunkan mutu. Pengguna dapat menambah atau mencabut skill per pesan lewat `skills[]` dan `skillsOff[]` di `POST /conversations/:id/messages` (menang atas kata kunci); skill yang tidak dikenal dibuang. Anggaran skill per run tetap sekitar 4.000 token: skill yang tidak muat dilewati utuh (dilaporkan sebagai `omittedSkills`), skill inti tidak pernah dibuang.

Keputusan (agent dan skill) tersimpan di `routing_decisions` dan tampil sebagai event `route.decided` (`reason`: "Agent project dengan skill …").

**Sejak P9 paket kata kunci tidak lagi menempel isi skill secara bawaan.** Skill dari paket yang cocok hanya *ditawarkan*: system prompt memuat bagian `# Skill tersedia` berisi satu baris `- <nama>: <deskripsi>` per skill, dan agent memilih sendiri mana yang dibuka. Yang tetap ditempel utuh: skill inti (`CORE_SKILLS`), skill milik agent, dan pilihan manual pengguna di composer (`skills[]`). Karena indeks hanya menampilkan deskripsi, setiap deskripsi skill wajib satu kalimat, maks. 200 karakter, dan menyebut KAPAN skill dipakai (divalidasi `SkillDescriptionSchema`).

Cara agent membuka skill berbeda per mesin, dan nama di indeks mengikutinya:

| Mesin | Nama di indeks | Cara membuka | Teramati |
| --- | --- | --- | --- |
| omp (worker) | `<id>` | tool `read skill://<id>` | ya, dari event `tool.started` di worker |
| Hermes (server) | `aios-<id>` | tool `skill_view` | ya, dari `hermes.tool.progress` (terverifikasi di Hermes 0.22.5) |

**Fallback per mesin.** `SKILL_PACKS_EAGER_ENGINES` (env gateway, daftar dipisah koma, mis. `hermes,dsh`) mengembalikan perilaku lama untuk mesin itu saja: isi paket ditempel utuh, tanpa indeks. Kosong (bawaan) = semua mesin memakai indeks. Pilihan manual composer selalu menempel isi, apa pun pengaturannya.

## Katalog skill (P9)

Gateway memegang satu katalog: skill bawaan repo (`source: builtin`) ditambah skill tambahan dari folder data gateway (`user`/`installed`/`agent`, dipakai P10). Tiap entri punya `id, name, description, version, source, checksum` (sha256 isi tanpa frontmatter). `GET /skills` mengembalikan indeks tanpa isi dan `GET /skills/:id` isi lengkap; keduanya butuh scope `app` atau `worker`.

- **omp.** Worker mengunduh isi skill yang ditawarkan ke cache miliknya (`<dataDir>/skills-cache`, bukan repo kerja dan bukan folder skill pengguna). Isi hanya diunduh bila checksum di indeks berubah, dan wajib cocok dengan checksum yang diumumkan. Setiap run memasang skill ke `<runDir>/agent/skills` dan mendaftarkan HANYA folder itu lewat `skills.customDirectories`. Omp memuat skill provider lain (`~/.claude`, `~/.agents`, `.claude/` di repo) dan membaca folder home dari sistem, bukan `$HOME`, sehingga flag wajib: `--skills=<id terpasang>`, atau `--no-skills` bila katalog kosong. Terbukti dengan omp sungguhan: `apps/worker/src/skills/omp-isolation.e2e.test.ts` memeriksa blok `<skills>` di prompt yang diterima model.
- **Hermes.** Sinkron ke Hermes SENGAJA langkah eksplisit, tidak berjalan otomatis: `pnpm skills:sync-hermes [--dry-run] [--verify]`. Skill ditulis ke `~/.hermes/skills/aios/<id>/SKILL.md` dengan nama `aios-<id>` (env `HERMES_SKILLS_DIR` mengganti akar). Hanya folder `aios/` yang disentuh; folder di dalamnya yang bukan buatan kita dibiarkan, dan symlink ditolak. Hermes tidak perlu restart: penemuan skill memakai tanda tangan berkas (TTL 30 dtk), dan sesi baru langsung melihat skill baru (terverifikasi dengan sesi nyata). Jalankan ulang perintah itu setiap skill katalog berubah.
- **Skill yang dibuka.** `context.used.openedSkills` hanya berisi skill yang benar-benar teramati dibuka (omp: `read skill://`, Hermes: `skill_view` pada `aios-<id>`). Tanpa bukti tidak dilaporkan. Dipisah dari `pinnedSkills` (yang ditempel utuh). `skills` tetap berarti "skill yang dimuat ke prompt" agar klien lama tidak berubah.
- **Evaluasi murah.** `pnpm eval:skills [--from=N] [--limit=N] [--engine=hermes|omp|all]` menjalankan 20 pesan contoh (umum, coding, riset, menulis, video) ke mesin sungguhan dan melaporkan skill yang dibuka per pesan. Bukan tes CI. Mesin yang tidak tersedia dilewati dengan alasan: Hermes perlu `HERMES_API_KEY` dan skill sudah disinkron; omp perlu `AIOS_EVAL_OMP_BASE_URL`, `AIOS_EVAL_OMP_API_KEY`, `AIOS_EVAL_OMP_MODEL`. Validitas set uji itu sendiri dicek offline oleh `eval-skills.test.ts`.

## Format file agent

Satu file per agent di `packages/roles/roles/<id>.md`. Frontmatter dibaca registri, isi markdown menjadi system prompt.

```md
---
id: project
name: Project
group: coding # coding | umum
engine: omp # omp | hermes | research
model: coding-main # nama combo di 9Router
fallback_model: coding-cheap
approval: ask # ask | auto-safe (baca saja otomatis)
skills: [scope-guard, read-context-first, plan-before-edit, verify-before-done, minimal-diff, rich-answers]
---

# Peran

# Cara kerja

# Definition of done

# Format output
```

Registri menolak file yang tidak valid (gateway gagal start, atau di mode dev perubahan ditolak dan versi lama dipakai). Agent `general` dan `project` wajib ada.

## Skill inti anti-melenceng (dimuat semua agent)

| Skill | Isi aturan |
| --- | --- |
| `scope-guard` | Agent dan skill adalah keahlian, bukan batas izin: kerjakan permintaan apa pun semampu alat yang ada. Bila satu langkah butuh alat yang tidak tersedia, kerjakan semua yang bisa lalu sebut cara menyelesaikan sisanya; tempat lain hanya disarankan sebagai tambahan. Jangan menyentuh file atau topik yang tidak diminta |
| `read-context-first` | Coding: baca AGENTS.md, struktur folder, file terkait. Umum: baca pesan sebelumnya dan memori relevan. Baru menulis setelah itu |
| `plan-before-edit` | Tugas lebih dari satu file atau ambigu: rencana bernomor 3–7 langkah dulu, maksimal satu pertanyaan klarifikasi |
| `verify-before-done` | Coding: jalankan typecheck, lint, tes terkait, sebutkan hasilnya. Riset: setiap klaim punya sumber. Dilarang mengklaim selesai tanpa bukti |
| `minimal-diff` | Ubah sesedikit mungkin, ikuti konvensi yang ada, tanpa refactor yang tidak diminta, tanpa dependensi baru tanpa alasan |

## Skill khusus (contoh isi)

| Skill | Isi aturan |
| --- | --- |
| `ui-baseline` | Token design system, spasi kelipatan 4, satu aksi primer per area, daftar larangan anti AI slop |
| `a11y-check` | Label untuk kontrol, fokus terlihat, urutan tab logis, kontras AA, target sentuh 44px/48dp |
| `ui-states` | Setiap layar punya state memuat, kosong, error, offline |
| `api-design` | Validasi dengan Zod di batas, kode status tepat, error berformat RFC 9457, idempotensi untuk POST yang bisa diulang |
| `safe-migrations` | Migrasi maju-mundur, tanpa menghapus kolom dalam satu langkah, backfill terpisah |
| `reproduce-first` | Reproduksi bug dulu, tulis tes gagal, baru perbaiki, lalu tes lulus |
| `source-verification` | Minimal 3 sumber independen untuk klaim penting, utamakan sumber primer, catat tanggal |
| `citation` | Setiap paragraf faktual ditutup rujukan [n] ke daftar sumber |
| `stop-slop` | Hindari frasa klise AI, kalimat pendek dan spesifik, sesuai suara pengguna |
| `script-structure` | Hook 3 detik, satu ide per adegan, penutup dengan ajakan yang jelas |

Format skill: `packages/roles/skills/<id>/SKILL.md` dengan frontmatter `name` dan `description`, isi berupa checklist singkat. Anggaran awal: total skill yang disuntik per run maksimal sekitar 4.000 token; skill tambahan dimuat hanya bila relevan.

**Contoh `scope-guard/SKILL.md`:**

```md
---
name: scope-guard
description: Mengerjakan permintaan apa pun semampu alat yang ada; tidak menolak topik, dan tidak menyentuh hal yang tidak diminta.
---

- Kerjakan permintaan pengguna sebaik mungkin, apa pun topiknya. Skill yang dimuat hanyalah keahlian tambahan, bukan batas izin: jangan menolak hanya karena topiknya di luar skill itu.
- Satu-satunya batas nyata adalah alat yang kamu punya. Bila satu langkah butuh alat yang tidak tersedia (mis. menulis langsung ke folder project dari chat umum), kerjakan semua yang bisa (mis. isi lengkap setiap berkas, masing-masing di blok kode dengan path-nya), lalu sebut singkat satu cara menyelesaikan sisanya. Jangan berhenti hanya dengan "itu bukan scope saya".
- Bila bagian lain lebih cocok dikerjakan di tempat lain (mis. chat project untuk mengubah berkas), sarankan itu sebagai tambahan setelah kamu mengerjakan bagianmu.
- Jangan mengubah file atau topik yang tidak disebut pengguna.
- Jika permintaan ambigu, ajukan tepat satu pertanyaan, lalu berhenti.
```

## Aturan perilaku agent di dalam aplikasi

Aturan ini berlaku untuk agent yang berjalan di aplikasi (bukan agent yang membangun aplikasi), dan disuntik bersama skill inti:

- Jawab dalam bahasa pengguna. Langsung ke jawaban, tanpa basa-basi.
- Jangan mengarang fakta, path file, atau hasil perintah. Jika tidak tahu, katakan dan tawarkan cara mencari tahu.
- Perintah yang mengubah sistem, menghapus file, atau mengakses jaringan selalu melalui approval kecuali ada aturan "selalu izinkan" untuk project itu.
- Tidak pernah membaca atau mengirim file `.env`, kunci SSH, atau folder di luar project tanpa izin eksplisit.

Run yang berjalan di server (Hermes, bukan run coding di worker) juga mendapat aturan "Berkas untuk pemilik" (`SERVER_FILES_RULE` di `apps/gateway/src/modules/runs/runner.ts`): pemilik tidak bisa mengakses sistem berkas server, jadi agent tidak membuat berkas atau arsip hasil di server dan tidak menjawab dengan path server, melainkan menulis isi setiap berkas sebagai blok kode berpath agar aplikasi bisa menawarkan Unduh ZIP.

## Halaman Skill: penyimpanan dan pengelolaan (P10)

Skill tambahan (`user`, `installed`, `agent`) disimpan di Postgres (`catalog_skills`, riwayat isi di `catalog_skill_versions`); skill bawaan repo tetap dari berkas dan hanya bisa dinonaktifkan (`skill_overrides`). Skill inti tidak bisa dinonaktifkan.

- **Versi:** mengubah nama, deskripsi, atau isi membuat versi baru; mengembalikan versi lama juga membuat versi baru (riwayat tidak dihapus). Mengubah mesin, `pinned`, atau `trust` tidak membuat versi.
- **Status:** `active` dipakai agent; `disabled` dan `archived` hilang dari indeks agent dan dari worker (worker mendapat 404), tetapi tetap tampil di halaman Skill.
- **Sampai ke agent:** skill aktif untuk suatu mesin yang `pinned` ditempel utuh seperti skill milik role; yang tidak `pinned` ditawarkan lewat indeks "Skill tersedia" (maks. 40 baris), dan pilihan manual di composer menempelkan isinya utuh. Di Hermes namanya `aios-<id>` (hasil sinkron), di omp `skill://<id>`.
- **Sinkron ke Hermes:** bila `HERMES_SKILLS_DIR` diisi, setiap perubahan katalog menyalin skill aktif untuk mesin `hermes` ke `<folder>/aios/`. Kosong = tidak ada sinkron otomatis (tetap bisa `pnpm skills:sync-hermes`, yang dengan `DATABASE_URL` ikut menyalin skill tambahan; tanpa `DATABASE_URL` ia tidak menghapus apa pun dari `aios/`).
- **Pemindai** (`scanner.ts`, aturan saja, bukan jaminan keamanan): prompt injection (Inggris/Indonesia), menyembunyikan tindakan dari pengguna, pengiriman data keluar, perintah merusak, eksekusi kode unduhan, membaca rahasia, karakter tak terlihat (zero-width/bidi), blok base64 panjang. Hasil `safe` / `warning` / `dangerous` dengan baris yang ditandai.

### Pasang dari luar dan impor dari Hermes (P10)

Gateway mengunduh `SKILL.md` dari id skills.sh atau URL GitHub, hanya dari `github.com`, `raw.githubusercontent.com`, dan `skills.sh`, maks. 64 KB, teks saja. Alurnya: **pratinjau** (isi lengkap, hasil pemindai, diff terhadap versi terpasang) lalu **pasang** dengan checksum yang dilihat pengguna. Berbahaya diblokir; peringatan butuh konfirmasi eksplisit. Trust awal `community`; pengguna menaikkannya ke `trusted` lewat `PATCH`.

Keterbatasan yang disengaja: hanya `SKILL.md` yang diambil. Folder `scripts/` dan berkas eksekusi tidak diunduh dan tidak pernah dijalankan (domain yang diizinkan tidak mencakup API GitHub untuk mendaftar isi folder), jadi skill yang bergantung pada skrip hanya membawa petunjuknya; pratinjau memberi tanda bila isi merujuk skrip.

Tab "Skill Hermes" hanya baca. Daftar dari `GET /v1/skills` Hermes; pada Hermes 0.22.5 endpoint itu menjawab 500, sehingga gateway membaca folder `HERMES_SKILLS_DIR` (tanpa menulis, tanpa mengikuti symlink, `aios/` dikecualikan). Isi hanya bisa diimpor dari folder.

### Layar desktop (P10 irisan 3)

Rute `/skills` (tautan "Skill" di kaki sidebar, di atas Pengaturan; tanpa pintasan Ctrl+angka sehingga `NAV_ROUTES` tetap). Tiga tab di `apps/desktop/src/skills/`:

- **Skill saya:** seluruh katalog (aktif, nonaktif, arsip) dengan saringan sumber dan sakelar aktif. Skill bawaan dibuka hanya baca. Editor skill buatan/terpasang: nama, deskripsi, isi, mesin, sematkan, trust, pindai, simpan, arsip, hapus, dan riwayat versi dengan pengembalian. Bila pemindai menahan simpan (`skill_scan_blocked`/`skill_scan_confirm`), temuan tampil di dialog dan simpan baru bisa setelah kotak persetujuan dicentang.
- **Pasang:** pratinjau (isi, pemindai, diff baris terhadap versi terpasang, catatan skrip tidak diunduh) lalu pasang dengan checksum pratinjau. Berbahaya: tombol mati tanpa jalan pintas. Peringatan: butuh centang. 409 checksum menyuruh pratinjau ulang.
- **Skill Hermes:** hanya baca, dengan asal data (`api`/`folder`/`none`), tombol **Periksa** dan tombol Impor. Impor langsung bila pemindai menilai `safe`. Bila pemindai meminta persetujuan (peringatan atau berbahaya), dialog Periksa terbuka: isi lengkap, temuan beserta barisnya, catatan skrip, lalu kotak persetujuan (bernada keras untuk `dangerous`) yang harus dicentang sebelum tombol Impor aktif. Skill yang tidak bisa diimpor (id bentrok, isi membawa frontmatter kedua) menampilkan alasannya dan tombol Impor mati.

Catatan tab Skill Hermes: folder dibaca sampai 2000 skill (pagar pengaman); bila terpotong, `note` memberi tahu. Skill Hermes yang isinya membawa frontmatter kedua ditolak saat impor (422 `skill_body_has_frontmatter`; isi tidak diubah otomatis). **Keputusan pemilik (P10):** hanya impor dari folder Hermes milik pemilik sendiri yang boleh menyetujui temuan `dangerous` dengan `acknowledge` (setelah melihat isi lewat `POST /skills/hermes/preview`). Pasang dari luar (github.com/skills.sh) dan skill usulan agent tetap tidak bisa melewati `dangerous`. Alasannya: pemindai berbasis aturan menandai skill yang *membahas* hal berbahaya (mis. daftar `deny: Bash(rm -rf *)`, contoh "Ignore previous instructions"), dan skill di folder Hermes sendiri berasal dari pemilik.

