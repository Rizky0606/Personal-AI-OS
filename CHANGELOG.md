# Changelog

Format mengikuti [Keep a Changelog](https://keepachangelog.com/id-ID/1.1.0/); versi mengikuti [SemVer](https://semver.org/lang/id/).

## [1.2.0] - belum dirilis

### Ditambah

- **Memori tersemat**: memori bisa disematkan di Pengaturan > Memori (desktop) dan layar Memori (Android); yang tersemat selalu ikut ke pesan sistem. Kontrak: `Memory.pinned`, `pinned` di `POST`/`PATCH /memories`.
- **`pnpm --filter @aios/gateway eval:memory`**: evaluasi recall memori pada fixture sintetis (60 fakta, 40 kueri) per mode `all` dan `lexical`; recall@12 leksikal kategori "cocok kata" dijaga tes regresi.
- Variabel opsional `MEMORY_RECALL_BUDGET_CHARS` (bawaan 6000) dan `MEMORY_RECALL_TOP_K` (bawaan 12).
- **Ekstraksi fakta memori (slice 3, bawaan mati):** setelah run chat umum dari pesan pemilik selesai, pekerjaan pg-boss `memory-extract` (satu per percakapan, tunda 45 detik) memanggil `MEMORY_EXTRACT_MODEL` sekali dengan teks pemilik saja (bukan jawaban asisten, lampiran, tautan, atau web). Fakta lolos hanya bila kutipannya benar-benar ada di pesan pemilik, tanpa pola injeksi, tanpa rahasia, satu kalimat, dan bukan duplikat (memori, usulan menunggu, yang ditolak/diurungkan 90 hari). Maks 2 usulan per giliran, 20 usulan menunggu, `MEMORY_EXTRACT_DAILY_MAX` panggilan per 24 jam (bawaan 40). Mode `MEMORY_EXTRACT_MODE`: `off` (bawaan), `propose` (usulan + notifikasi `memory_proposal`), `auto` (langsung tersimpan, bisa diurungkan). Project, ruang, tim, dan jadwal tidak pernah diekstrak; gagal ekstraksi tidak mengubah hasil run.
- REST `GET /memories/proposals`, `POST /memories/proposals/:id/approve` (teks suntingan opsional), `/reject`, `/undo` (klaim atomik; `409 proposal_decided`, `409 proposal_not_undoable`, `409 proposal_target_missing`). Kontrak aditif: `Memory.source` dan `Memory.origin`, `MemoryProposal`, `notification.topic = memory_proposal`. Migrasi `0019_memory_proposals` (kolom asal di `memories`, tabel `memory_proposals` dan `memory_extractions`).
- Desktop: blok "Usulan memori" di Pengaturan > Memori (Simpan, Ubah lalu simpan, Tolak) dan tautan "Dari percakapan" pada memori hasil ekstraksi. Android: usulan dengan Simpan/Tolak di layar Memori.
- **Tool gateway lewat MCP untuk agent project (slice 1, bawaan mati):** gateway menyajikan server MCP `aios_tools` di `POST /v1/mcp` dengan `web_search` (SearXNG milik sistem) dan `web_read` (pengambil halaman aman SSRF, hanya URL dari hasil pencarian run itu atau dari pesan pemilik). omp di worker memanggilnya lewat relay loopback per run; token perangkat tidak pernah sampai ke omp. Izin jaringan ditanyakan dengan "selalu izinkan" per nama tool per project, dan tetap boleh di mode rencana karena hanya membaca. Dinyalakan dengan `MCP_TOOLS_ENABLED=true` (kontrak aditif `run.start.gatewayTools`). Langkahnya tampil sebagai langkah web di Aktivitas dan Progres (desktop dan Android). Desain dan slice berikutnya: `docs/DESIGN_MCP_TOOLS.md`.
- **Tool data `aios_tools` (slice 2):** `memory_list`, `space_search` (metode baru pencarian FTS lintas ruang), `task_list` (hanya kanban project run itu) dan `schedule_list` untuk omp, baca saja, keluaran berpagar sebagai data, maks. 50 butir dan 30 panggilan per run, audit tanpa isi. Worker mengizinkannya tanpa bertanya (juga di mode rencana). Langkahnya tampil sebagai "Membaca data AIOS" dan grup alat "Data AIOS" di Progres (desktop dan Android). Tanpa migrasi; ikut `MCP_TOOLS_ENABLED`.

### Diubah

- **Recall memori beranggaran** (slice 1 `docs/DESIGN_MEMORI_SEMANTIK.md`): selama bagian memori muat di anggaran, keluaran sama persis seperti sebelumnya; di atas anggaran dipilih yang tersemat, yang cocok kata dengan pesan pemilik (ditambah pesan pemilik sebelumnya), lalu yang terbaru. Memori dibaca sekali per run; `context.used.memory` kini sama persis dengan yang disuntik dan bertambah `total`, `mode`, `items[].via`. Panel Progres menampilkan "Dibaca · N dari M fakta" bila sebagian tidak ikut.
- Migrasi aditif `0018_memories_recall`: `memories.pinned` (bawaan false) dan `memories.tsv` (tsvector `simple`, indeks GIN).
- **Composer desktop**: Rencana dulu, Kerjakan sebagai tim, Cari di web, dan Skill digabung ke satu menu "Opsi"; tab pane menjadi satu pill aktif + dropdown "Ganti tab" bila pane sempit (< 300 px). Perbaikan lanjutan: lint/format, bayangan tab aktif memakai token `shadow-lift`, dan tes mengikuti menu Opsi.

## [1.1.0] - 2026-11-15

Merangkum pekerjaan sesi P1 sampai P11 (dikerjakan di cabang `fix/*` dan `feat/*`; **sudah digabung ke `main`**, `b26d61e`, 2026-11-13). **Perombakan "Command Center" yang tercatat di sini sebelumnya sudah ditulis ulang total** menjadi shell "pulau" (lihat Diubah); catatan lama dihapus karena tidak lagi menggambarkan kode yang ada.

### Diubah

- **Shell desktop ditulis ulang total** menjadi tiga pulau terpisah (sidebar, area utama, panel kanan) berjarak 8 px dari tepi jendela, bukan rail/status-bar/Command Center. Topbar satu-satunya pemilik judul halaman (`h1`); chip "Lokasi saat ini" (project, branch, status run, model).
- **Jawaban AI** tanpa kartu tebal: avatar `AgentOrb` 28 px, baris aktivitas tool di dalam jawaban (judul berkilau, baris terlipat, linimasa), ringkasan "Selesai · durasi · N langkah".
- **Pemilihan mesin agent** (Otomatis/omp/Hermes/dsh) bisa dipaksa eksplisit per pesan lewat composer, dengan validasi konteks (omp butuh project, dsh tidak boleh di project).
- **Palet Electric Slate** dan polish gerak (P0 sebelum rework P1) ditimpa oleh token shell pulau baru (radius, jarak, kontras); detail di `docs/DESIGN_SYSTEM.md`.
- Hapus klaim role otomatis pada teks sambutan; hapus pemilih role manual (digantikan router otomatis lalu, akhirnya, dihapus total bersama skill paket per permintaan pemilik — lihat `docs/BACKLOG.md` Fase 48).
- **Skill paket kata kunci tidak lagi ditempel utuh ke prompt** (P9): skill dari paket yang cocok hanya ditawarkan sebagai indeks (`# Skill tersedia`) dan agent membuka sendiri yang diperlukan (omp: `read skill://`, Hermes: `skill_view`); skill inti, milik agent, dan pilihan manual tetap ditempel. `SKILL_PACKS_EAGER_ENGINES` mengembalikan perilaku lama per mesin.

### Ditambah

- **Panel Progres**: rencana (todo), hasil kerja (diff, berkas, gambar, laporan riset), dan konteks yang digunakan (skill, memori, lampiran) dalam satu panel tiga bagian; chip "Langkah N dari M" di Topbar.
- **Jawaban kaya**: tabel, grafik, daftar langkah, dan angka penting lewat blok `aios-ui` (skill inti `rich-answers`, berlaku untuk semua role dan semua mesin).
- **Thumbnail bukti**: screenshot dan SVG dari tool agent tampil sebagai thumbnail di baris aktivitas dan panel Progres; lightbox dengan Esc untuk menutup.
- **Tim Orca (ORCA Lead → Worker)**: tombol "Kerjakan sebagai tim" di composer project; Lead (Hermes) merencanakan, membagi tugas ke Worker (omp), dan meninjau hasilnya (terima, revisi, tolak). Tugas dikerjakan berurutan, satu Worker pada satu waktu (`maxWorkers` saat ini maksimal 1). Panel Progres menampilkan pohon Lead → tugas → Worker; persetujuan izin agregat dan tombol hentikan per-anggota/seluruh tim. Tidak ada auto-merge; pemilik memutuskan di luar tim.
- **dsh** sebagai pilihan mesin pratinjau (label "Pratinjau", tooltip "belum diaudit"): butuh `DSH_COMMAND` dikonfigurasi di server, muncul di `GET /engines` bila jabat tangan ACP berhasil.
- Rekaman nyata adapter Hermes (7 skenario, Hermes 0.22.5) menggantikan asumsi sebelumnya; dua temuan penting dicatat di `docs/ADAPTER_EVENTS.md`: Hermes tidak menghentikan tool yang berjalan saat koneksi diputus, dan `hermes.tool.progress` tidak pernah melapor gagal (galat masuk ke teks jawaban).
- Android: panel izin baru (deskripsi lengkap, folder kerja, tiga tombol dengan target sentuh 48 dp, satu pengumuman TalkBack), panel Progres (fixture sama dengan desktop), cap build (`BuildConfig.BUILD_COMMIT`) di layar Tentang.
- **Katalog skill** (P9): `GET /skills` dan `GET /skills/:id` dengan checksum; worker mengunduh skill yang ditawarkan ke cache sendiri dan omp hanya melihat skill itu; sinkron ke Hermes lewat langkah eksplisit `pnpm skills:sync-hermes`; `context.used` melaporkan `openedSkills`/`pinnedSkills` dan panel Progres menampilkan skill yang terbukti dibuka; evaluasi `pnpm eval:skills` (bukan tes CI).
- **Skill pengguna** (P10): halaman Skill desktop (`/skills`: skill saya, pasang, Skill Hermes) untuk membuat, mengubah, menonaktifkan, mengarsipkan, menghapus, melihat riwayat versi, dan memulihkan; pasang dari skills.sh/GitHub dengan pratinjau, checksum terkunci, dan pemindai (hanya `SKILL.md` yang diunduh, tanpa skrip); impor dari folder Hermes dengan pratinjau. Android: layar Skill di Pengaturan (daftar dan aktif/nonaktif saja).
- **Usulan skill dan kurator** (P11): agent mengusulkan skill baru atau tambalan lewat blok `aios-skill-proposal` (skill inti `propose-skill`), skill baru buatan Hermes terdeteksi sebagai usulan; usulan hanya menjadi skill setelah Setujui / Edit lalu setujui di desktop (maks. 1 per jawaban, 3 per 24 jam; rahasia ditolak). Kurator mingguan (Senin 03:00 UTC, bisa dijalankan manual) menandai skill `agent` yang tidak dibuka 30 hari, mengarsipkan setelah 90 hari, tidak pernah menghapus, dan mengirim laporan sebagai notifikasi.

### Diperbaiki

- **Balapan `review.apply` vs run selesai** (worker): klien yang melihat run "selesai" lalu langsung menerima/menolak hasil bisa ditolak diam-diam (`run_active`) tanpa worktree pernah terhapus. Flag internal kini berubah serentak dengan event penutup, bukan menunggu pembersihan proses selesai.
- Tes harness dsh (`dshTestIdentity`) yang salah mensimulasikan "bukan root" saat benar-benar dijalankan sebagai root di Linux (ditemukan saat verifikasi gerbang P8; tidak memengaruhi kode produksi).
- Deretan perbaikan bug kecil P3 (lebar input `TextField`, label kuota sidebar, keterangan model dari data server, pemilih model dinonaktifkan untuk Hermes, xterm menunggu font siap) dan P4b (mesin dipaksa, chip agent di Topbar, `ProjectList` mati dihapus).
- **Balapan status tim Orca** (gateway): tim dilaporkan `completed` sebelum rencana Lead tersimpan, sehingga panel berhenti memoll dan menampilkan "Tim selesai." tanpa tugas (penyebab flake `team.spec`).
- Parser `SKILL.md` menolak skill publik yang `description`-nya ditulis sebagai skalar YAML bertingkat; daftar skill Hermes terpotong diam-diam di 300 entri (kini batas 2000 dan pemotongan diberitahukan).
- **Deploy otomatis VPS tidak pernah berjalan**: `infra/scripts/auto-deploy.sh` tersimpan di git tanpa bit eksekusi (mode 100644), sehingga `aios-deploy.service` gagal `203/EXEC` setiap 10 menit sejak timer dipasang (2026-10-27). Mode diperbaiki menjadi 100755; `infra/scripts/selftest.sh` kini memeriksa bahwa setiap skrip yang dipanggil `ExecStart` unit di `infra/systemd/` bisa dieksekusi. Akibatnya, setelah perbaikan ini terpasang di VPS, timer benar-benar men-deploy tag rilis baru secara otomatis.

### Diketahui

- dsh sebagai root belum terbukti bekerja ujung-ke-ujung di CI Docker/VPS produksi (hanya diverifikasi di satu mesin pengembangan Linux dengan kendala tata letak folder yang spesifik mesin itu). Hermes dan dsh **nyata** (bukan tiruan) belum pernah dicoba dalam alur pengguna lengkap sejak P5 (Hermes) dan sama sekali (dsh). Lihat `docs/BACKLOG.md` "Ringkasan status gerbang P8" untuk daftar lengkap blocker/penting/nanti.
- Sudah digabung ke `main` (`b26d61e`). Gateway dari commit itu (tag otomatis `v1.0.46`) sudah di-deploy ke VPS pada 2026-11-15 setelah backup (snapshot restic `0bed8dcf`): migrasi 0011–0017 diterapkan, `/v1/readyz` ok. Tag `v1.1.0` diterbitkan oleh rilis ini (lihat `docs/RELEASE_NOTES.md`).
- Skill (P9–P11): ketepatan pemilihan skill belum diukur ulang setelah perbaikan nama indeks; `propose-skill` belum diuji terhadap model sungguhan; kurator dan pemantau Hermes belum dijalankan terhadap pg-boss produksi; Android tanpa layar usulan. Lihat `docs/BACKLOG.md` "Temuan P9" sampai "Temuan P11".

## [1.0.3] - 2026-10-25

### Diubah

- Palet baru **Electric Slate** (navy slate, aksen cyan elektrik, teal, dan emerald) di desktop dan Android, tema gelap dan terang; kontras teks tetap WCAG AA.
- Jawaban AI tampil dalam kartu dengan avatar bot dan titik status, nama, chip role berbentuk pil, dan model; gelembung pengguna menampilkan jam kirim dan tanda terkirim; logo di rail desktop.
- Sudut lebih bulat (kartu 16 px, kontrol 8 px) dan ikon aplikasi navy-cyan.
- Action GitHub diperbarui ke versi Node 24; runner dikunci ke Ubuntu 24.04.
- Backup: dump database tanpa kompresi internal (restic dedup + zstd max) dan retensi 31 hari.

## [1.0.2] - 2026-10-24

### Diubah

- Tampilan lebih hidup tapi tetap rapi (desktop dan Android): layar sambutan di chat kosong dengan cahaya aksen dan kartu saran yang muncul bertahap; tombol utama bergradien oranye dan bercahaya; pesan muncul dengan pegas ringan; indikator sedang menulis bercahaya; item aktif dengan sapuan aksen; kartu kanban terangkat saat hover.
- Chat project menampilkan saran pekerjaan coding (struktur project, perbaiki bug, tambah fitur, tulis tes).
- Design system: token gerak baru (emphasis 320 ms, kurva pegas ringan); gradien satu warna aksen dan cahaya aksen kini diizinkan di titik-titik penting.

## [1.0.1] - 2026-10-24

Rilis stabil pertama yang diterbitkan lewat tag (build `1.0.0` sebelumnya hanya artefak CI dari `main`). Mulai rilis ini versi naik di setiap tag, sehingga installer Windows dan APK Android terpasang menimpa versi sebelumnya, dan aplikasi Windows memperbarui diri lewat bagian Pembaruan di Pengaturan.

### Ditambahkan

- **Chat** umum dan chat project dengan streaming, pemilihan role dan model, router otomatis, penjadwalan, dan riset bersitasi (desktop dan Android).
- **Run coding** lewat worker lokal dan omp: worktree per run, izin (approval) inline, diff dengan komentar, terima/tolak, commit Conventional pada branch `aios/<id>`.
- **Kanban AI**: kartu dikerjakan AI dengan batas run paralel dan antrean; pecah ide menjadi kartu.
- **Preview dan pengujian**: preview dev server di panel kanan, console, pilih elemen ke composer, tool browser (Playwright) untuk agent.
- **Terminal** PTY, palet perintah (Ctrl+K), status bar lengkap, pembanding model, halaman Kuota dan Status.
- **Keamanan**: audit otomatis (`docs/SECURITY_AUDIT.md`), backup dan restore terenkripsi (restic), Uptime Kuma, pemeriksaan versi tool.
- **Pengemasan**: installer Windows NSIS dengan sidecar worker; auto-update Tauri dari rilis GitHub (bagian Pembaruan di Pengaturan); APK Android release bertanda tangan lewat CI.
- **Deploy**: `infra/scripts/deploy.sh` (build arm64, migrasi, restart, cek `/v1/readyz`, rollback image bila gagal).
- **Lampiran chat**: gambar (dikirim ke model vision), PDF, DOCX, dan berkas teks (diambil teksnya) dari desktop (pilih, seret, tempel) dan Android (pemilih dokumen).
- **Ubah dan hapus pesan** di mana pun dalam percakapan; agent memulai sesi baru dengan riwayat yang tersisa sehingga bagian yang dibuang tidak diingat.
- **Rilis bertag**: `infra/scripts/release.mjs` menaikkan versi dan membuat tag; versionCode Android naik di setiap build CI.
- **Uji E2E** desktop (Playwright, stack nyata: gateway, worker, omp) dan Android (Compose UI test melawan gateway nyata), plus audit aksesibilitas axe dan lint desain statis.

### Diubah

- Token warna `text-3` dan `accent` (terang) disesuaikan agar lolos kontras WCAG AA; `docs/DESIGN_SYSTEM.md` diperbarui.
- Animasi skeleton memakai kurva token; `prefers-reduced-motion` tidak lagi menyebabkan animasi berkedip.
- Gerak dan polish antarmuka (pesan muncul halus, indikator sedang menulis, penanda aktif, menu dan dialog beranimasi) di desktop dan Android.
- Alamat gateway tertanam saat build; layar login hanya meminta password dan TOTP.
- Role ditentukan router (pemilih role di composer dihapus); role Umum boleh menulis kode di chat; chat project mengutamakan role coding.

### Diperbaiki

- Worker sidecar `.exe` tidak lagi mati saat start (playwright-core dimuat malas), sehingga status worker tersambung.
- Riset tidak lagi gagal di tahap menulis laporan karena batas waktu; galat model dipetakan ke pesan yang jelas.
- Urutan pesan chat desktop tidak lagi terbalik.

### Diketahui

- Kartu Kanban yang butuh izin belum punya UI izin sendiri; izin dijawab dari percakapan kartu (lihat `docs/BACKLOG.md`).
- Aplikasi Windows yang terpasang dari build `main` sebelum rilis ini belum membawa kunci updater: pasang installer rilis ini sekali secara manual, setelah itu pembaruan berjalan dari aplikasi.
