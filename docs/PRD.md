# PRD — Personal AI OS

Produk ini adalah satu asisten AI pribadi dengan dua wajah: Windows untuk kerja coding berbasis project, Android untuk chat, riset, dan jadwal. Penggunanya satu orang (pemilik), bukan publik.

## Masalah

- Tools agent yang bagus (omp, Hermes, 9Router) tersebar di terminal, Telegram, dan dashboard terpisah.
- Tidak ada satu tempat untuk chat umum, chat per project, kanban, preview, dan jadwal sekaligus.
- Agent sering melenceng karena tidak ada peran dan aturan yang tegas per jenis tugas.

## Tujuan

1. Satu akun, satu riwayat, satu memori untuk Windows dan Android.
2. Tugas coding berjalan aman di folder project Windows, dengan hasil berupa diff yang bisa ditinjau.
3. Setiap pesan otomatis diarahkan ke agent role yang tepat, tanpa perlu menulis `@role`.
4. Riset dan jadwal tetap berjalan di VPS walau aplikasi ditutup.

## Non-goals

- Bukan multi-user, bukan SaaS, tanpa billing atau RBAC.
- Android tidak mengendalikan Windows dan tidak membaca folder project.
- Tidak membuat model sendiri dan tidak menulis ulang mesin agent.
- Tidak menyalin semua fitur Antigravity, Orca, atau Codex. Hanya alur yang tercantum di bawah.

## Fitur Windows

| ID | Fitur | Prioritas | Keterangan singkat |
| --- | --- | --- | --- |
| W1 | Chat umum | P0 | Chat dengan router role, pilih model, lampiran |
| W2 | Chat per folder project | P0 | Agent bekerja di folder terpilih via adapter omp |
| W3 | Run di git worktree | P0 | Satu worktree per run atau kartu, tidak menyentuh branch kerja |
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

## Fitur Android

| ID | Fitur | Prioritas | Keterangan singkat |
| --- | --- | --- | --- |
| A1 | Chat | P0 | Streaming, router role, pilih model, lampiran gambar dan file |
| A2 | Deep research | P0 | Berjalan di VPS, laporan bersitasi, progres terlihat |
| A3 | Jadwal | P1 | Lihat, buat, jeda, riwayat run |
| A4 | Notifikasi | P1 | Riset atau jadwal selesai |
| A5 | Input suara | P1 | STT, lalu teks bisa diedit sebelum dikirim |
| A6 | Share ke chat | P1 | Teks atau link dari aplikasi lain masuk sebagai pesan baru |
| A7 | Ekspor | P2 | Laporan riset ke Markdown atau PDF |

## Fitur server (dipakai keduanya)

- Auth satu pemilik dengan perangkat terdaftar.
- Router role otomatis dan registri role serta skill.
- Riwayat chat, kanban, jadwal, dan laporan riset sebagai sumber kebenaran.
- Memori jangka panjang lewat Hermes.

## Alur pengguna utama

1. **Chat umum (Android atau Windows):** ketik pesan, router memilih role, jawaban mengalir, chip role bisa diganti.
2. **Tugas coding (Windows):** pilih folder, tulis tugas atau klik kartu kanban, agent bekerja di worktree, minta izin bila perlu, hasil diff ditinjau, lalu terima.
3. **Riset (Android):** tulis pertanyaan, rencana riset tampil, job jalan di VPS, notifikasi saat laporan siap.
4. **Jadwal:** tulis dalam bahasa alami ("setiap Senin 07.00 ringkas berita AI"), sistem mengusulkan cron dan prompt, pengguna konfirmasi.

## Metrik keberhasilan

- Routing benar minimal 90% pada set uji per role.
- Token pertama chat muncul di bawah 2 detik di jaringan normal.
- Nol perubahan file di luar worktree tanpa persetujuan.
- Reconnect otomatis setelah koneksi putus dalam 10 detik, tanpa langkah manual.
- Jadwal berjalan tepat waktu dengan toleransi 1 menit.
