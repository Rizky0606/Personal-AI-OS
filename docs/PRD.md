# PRD — Personal AI OS

Produk ini adalah satu asisten AI pribadi dengan dua wajah: Windows untuk kerja coding berbasis project, Android untuk chat, riset, dan jadwal. Penggunanya satu orang (pemilik), bukan publik.

## Masalah

- Tools agent yang bagus (omp, Hermes, 9Router) tersebar di terminal, Telegram, dan dashboard terpisah.
- Tidak ada satu tempat untuk chat umum, chat per project, kanban, preview, dan jadwal sekaligus.
- Agent sering melenceng karena tidak ada peran dan aturan yang tegas per jenis tugas.

## Tujuan

1. Satu akun, satu riwayat, satu memori untuk Windows dan Android.
2. Tugas coding berjalan aman di folder project Windows, dengan hasil berupa diff yang bisa ditinjau.
3. Agent dan skill ditentukan otomatis, tanpa memilih role dan tanpa menulis `@role`: dua agent tetap dipilih dari ada tidaknya project (chat per folder project di Windows = agent project, selain itu agent umum), dan skill spesialis ditawarkan dari paket kata kunci pesan atau dipilih dari katalog skill.
4. Riset dan jadwal tetap berjalan di VPS walau aplikasi ditutup.

## Non-goals

- Bukan multi-user, bukan SaaS, tanpa billing atau RBAC.
- Android tidak mengendalikan Windows dan tidak membaca folder project.
- Tidak membuat model sendiri dan tidak menulis ulang mesin agent.
- Tidak menyalin semua fitur Antigravity, Orca, atau Codex. Hanya alur yang tercantum di bawah.

## Fitur Windows

| ID | Fitur | Prioritas | Keterangan singkat |
| --- | --- | --- | --- |
| W1 | Chat umum | P0 | Chat dengan agent umum dan skill otomatis, pilih model, lampiran |
| W2 | Chat per folder project | P0 | Agent bekerja di folder terpilih via adapter omp |
| W3 | Folder kerja run | P0 | Run chat project bawaannya bekerja langsung di branch aktif folder project (tanpa commit sebelum diterima); git worktree terpisah per run untuk kartu, armada, tim, jadwal, atau bila dipilih per project/per pesan |
| W4 | Review diff | P0 | Diff per file, komentar per baris dikirim balik ke agent, terima atau tolak |
| W5 | Tool approvals | P0 | Izin per perintah atau tool, dengan aturan izinkan selalu per project |
| W6 | Kanban AI | P1 | Backlog, Todo, Running, Review, Done; tombol Kerjakan dengan AI; AI memecah ide jadi kartu |
| W7 | Preview website | P1 | Dev server di WebView, ukuran perangkat, reload |
| W8 | Testing dengan Playwright | P1 | Agent bisa screenshot, klik, baca error console |
| W9 | Pilih elemen ke agent | P2 | Klik elemen di preview, HTML dan screenshot masuk ke chat |
| W10 | Jadwal | P1 | Daftar dan buat jadwal, disimpan di VPS |
| W11 | Terminal terpadu | P2 | Terminal per project |
| W12 | Checkpoint dan undo | P1 | Kembalikan worktree ke titik sebelum langkah agent |
| W13 | Pembanding model | P2 | Satu prompt ke beberapa model berdampingan |
| W14 | Dasbor kuota | P2 | Pemakaian dan kuota dari 9Router |
| W15 | Command palette | P1 | Ctrl+K untuk semua aksi |
| W16 | Pratinjau artifact | P1 | Blok HTML, SVG, React, dan Mermaid dijalankan di halaman terisolasi |
| W17 | Memori terlihat | P1 | Lihat, ubah, hapus fakta yang diingat AI; aksi Ingat ini |
| W18 | Briefing pagi | P2 | Rangkuman harian riset, kanban, dan jadwal |
| W19 | Jadwal dengan ingatan | P2 | Notifikasi hanya bila hasil berubah dari run sebelumnya |
| W20 | Quick Ask global | P2 | Hotkey dari aplikasi mana pun membuka jendela tanya cepat |
| W21 | Ruang pengetahuan | P2 | Dokumen yang diunggah jadi sumber jawaban bersitasi |
| W22 | Pencarian riwayat | P2 | Cari di semua pesan chat dan laporan riset |
| W23 | Aturan per project | P2 | Instruksi project yang ikut disuntik ke run coding |
| W24 | Ruang Kerja multi-run | P1 | Daftar semua run coding dengan status live (berjalan, menunggu izin, perlu review, selesai); memilih satu membuka chat, diff, dan preview-nya |
| W25 | Panel terbagi | P1 | Panel kanan dibagi horizontal atau vertikal; tiap pane berisi chat, terminal, diff, preview, atau berkas; tata letak diingat |
| W26 | Berkas worktree | P1 | Pohon berkas, penyorotan sintaks, pratinjau Markdown dan gambar, quick-open Ctrl+P, seret berkas ke prompt |
| W27 | Templat prompt | P2 | Prompt tersimpan berparameter (`/nama`) dari composer dan palette |
| W28 | Pendapat kedua | P2 | Model lain meninjau diff sebelum diterima; temuan bisa dikirim balik sebagai komentar |
| W29 | Mode rencana | P2 | Run coding hanya membaca dan menulis rencana; berkas baru boleh diubah setelah rencana disetujui |
| W30 | Lanjut dengan ringkasan | P2 | Percakapan panjang diringkas menjadi konteks awal percakapan baru |
| W31 | Cabang percakapan | P2 | Fork percakapan dari pesan mana pun tanpa menghapus jalur lama |

## Fitur Android

| ID | Fitur | Prioritas | Keterangan singkat |
| --- | --- | --- | --- |
| A1 | Chat | P0 | Streaming, agent umum dan skill otomatis, pilih model, lampiran gambar dan file |
| A2 | Deep research | P0 | Berjalan di VPS, laporan bersitasi, progres terlihat |
| A3 | Jadwal | P1 | Lihat, buat, jeda, riwayat run |
| A4 | Notifikasi | P1 | Riset atau jadwal selesai |
| A5 | Input suara | P1 | STT, lalu teks bisa diedit sebelum dikirim |
| A6 | Share ke chat | P1 | Teks atau link dari aplikasi lain masuk sebagai pesan baru |
| A7 | Ekspor | P2 | Laporan riset ke Markdown atau PDF |
| A8 | Pratinjau artifact | P1 | Sama dengan W16 |
| A9 | Memori terlihat | P1 | Sama dengan W17 |
| A10 | Briefing pagi | P2 | Push rangkuman harian |
| A11 | Jadwal dengan ingatan | P2 | Sama dengan W19 |
| A12 | Asisten bawaan | P2 | Bisa dipilih sebagai aplikasi asisten digital Android |
| A13 | Ruang pengetahuan | P2 | Sama dengan W21 |
| A14 | Pencarian riwayat | P2 | Sama dengan W22 |
| A15 | Widget dan tile | P3 | Tanya cepat dan catat ide dari layar utama |

## Fitur server (dipakai keduanya)

- Auth satu pemilik dengan perangkat terdaftar.
- Dua agent tetap (umum dan project; agent peneliti hanya untuk fitur Riset) yang dipilih server dari ada tidaknya project dengan aturan tetap, tanpa router model; registri agent dan katalog skill (skill bawaan, buatan pengguna, terpasang dari luar, dan usulan agent), dengan skill spesialis dipilih dari paket kata kunci pesan atau manual per pesan.
- Riwayat chat, kanban, jadwal, dan laporan riset sebagai sumber kebenaran.
- Memori jangka panjang lewat Hermes.

## Alur pengguna utama

1. **Chat umum (Android atau Windows):** ketik pesan, server memilih skill dari isi pesan, jawaban mengalir.
2. **Tugas coding (Windows):** pilih folder, tulis tugas atau klik kartu kanban, agent bekerja di worktree, minta izin bila perlu, hasil diff ditinjau, lalu terima.
3. **Riset (Android):** tulis pertanyaan, rencana riset tampil, job jalan di VPS, notifikasi saat laporan siap.
4. **Jadwal:** tulis dalam bahasa alami ("setiap Senin 07.00 ringkas berita AI"), sistem mengusulkan cron dan prompt, pengguna konfirmasi.

## Metrik keberhasilan

- Pemilihan agent deterministik: chat per folder project di Windows selalu memakai agent project, selain itu agent umum (aturan tetap tanpa model, tercakup tes otomatis). Router role otomatis beserta target akurasi routing 90% sudah dihapus (`docs/BACKLOG.md` Fase 48).
- Skill yang ditawarkan mengikuti paket kata kunci pesan dan pilihan pengguna; ketepatan skill yang benar-benar dibuka agent diukur dengan `pnpm eval:skills` (20 pesan contoh, bukan gerbang CI, belum ada ambang lulus).
- Token pertama chat muncul di bawah 2 detik di jaringan normal.
- Nol perubahan file di luar folder kerja run (folder project pada mode branch aktif, atau worktree) tanpa persetujuan; tidak ada commit ke branch pemilik sebelum diterima.
- Reconnect otomatis setelah koneksi putus dalam 10 detik, tanpa langkah manual.
- Jadwal berjalan tepat waktu dengan toleransi 1 menit.
