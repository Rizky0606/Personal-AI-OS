# Agent & Skill Spec — Personal AI OS

Aplikasi punya **dua agent tetap**. Yang membedakannya hanya ada tidaknya project, bukan isi pesan. Kemampuan khusus (tampilan, API, debugging, review, riset, menulis) datang dari **skill** yang dimuat per permintaan. Tidak ada router model, tidak ada pemilihan role oleh pengguna, dan tidak ada `@role` (keputusan pemilik, Fase 48: role dihapus, diganti banyak skill).

## Agent (3 file, 2 dipilih per pesan)

| Agent | Grup | Mesin | Dipakai untuk | Skill milik agent |
| --- | --- | --- | --- | --- |
| `general` | Umum | Hermes (server) | Chat umum di tab Chat dan semua chat Android: pertanyaan apa pun, menulis dan menjelaskan kode di chat, tidak terikat folder project | answer-first, clarify-once |
| `project` | Coding | omp (worker Windows) | Chat per folder project di tab Project dan run kartu kanban: membaca, mencari, menjawab, dan mengubah kode di folder project itu (worktree run) | (hanya skill inti) |
| `researcher` | Umum | Research engine + Hermes | Hanya fitur Riset dan jadwal riset; tidak pernah dipilih untuk pesan chat | source-verification, citation, fact-vs-opinion |

**Aturan pemilihan agent** (`pickAgent`, `packages/roles/src/agents.ts`; tanpa model dan tanpa jaringan): `surface = windows` dan ada project → `project`; selain itu → `general`. Android dengan atau tanpa project tetap `general` karena tidak punya akses ke folder.

## Paket skill: skill spesialis dipilih dari kata kunci

`selectSkills` memeriksa teks pesan terhadap pola kata kunci (`SKILL_PACKS`) dan memuat skill dari paket yang cocok, berurutan, tanpa duplikat. Paket `frontend` dan `backend` hanya untuk agent `project`.

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
skills: [scope-guard, read-context-first, plan-before-edit, verify-before-done, minimal-diff]
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
