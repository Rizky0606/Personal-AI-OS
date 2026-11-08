# Changelog

Format mengikuti [Keep a Changelog](https://keepachangelog.com/id-ID/1.1.0/); versi mengikuti [SemVer](https://semver.org/lang/id/).

## [1.1.0] - 2026-11-08

Merangkum pekerjaan sesi P1 sampai P8 (perbaikan berantai di cabang `fix/*`, belum digabung ke `main`). **Perombakan "Command Center" yang tercatat di sini sebelumnya sudah ditulis ulang total** menjadi shell "pulau" (lihat Diubah); catatan lama dihapus karena tidak lagi menggambarkan kode yang ada.

### Diubah

- **Shell desktop ditulis ulang total** menjadi tiga pulau terpisah (sidebar, area utama, panel kanan) berjarak 8 px dari tepi jendela, bukan rail/status-bar/Command Center. Topbar satu-satunya pemilik judul halaman (`h1`); chip "Lokasi saat ini" (project, branch, status run, model).
- **Jawaban AI** tanpa kartu tebal: avatar `AgentOrb` 28 px, baris aktivitas tool di dalam jawaban (judul berkilau, baris terlipat, linimasa), ringkasan "Selesai · durasi · N langkah".
- **Pemilihan mesin agent** (Otomatis/omp/Hermes/dsh) bisa dipaksa eksplisit per pesan lewat composer, dengan validasi konteks (omp butuh project, dsh tidak boleh di project).
- **Palet Electric Slate** dan polish gerak (P0 sebelum rework P1) ditimpa oleh token shell pulau baru (radius, jarak, kontras); detail di `docs/DESIGN_SYSTEM.md`.
- Hapus klaim role otomatis pada teks sambutan; hapus pemilih role manual (digantikan router otomatis lalu, akhirnya, dihapus total bersama skill paket per permintaan pemilik — lihat `docs/BACKLOG.md` Fase 48).

### Ditambah

- **Panel Progres**: rencana (todo), hasil kerja (diff, berkas, gambar, laporan riset), dan konteks yang digunakan (skill, memori, lampiran) dalam satu panel tiga bagian; chip "Langkah N dari M" di Topbar.
- **Jawaban kaya**: tabel, grafik, daftar langkah, dan angka penting lewat blok `aios-ui` (skill inti `rich-answers`, berlaku untuk semua role dan semua mesin).
- **Thumbnail bukti**: screenshot dan SVG dari tool agent tampil sebagai thumbnail di baris aktivitas dan panel Progres; lightbox dengan Esc untuk menutup.
- **Tim Orca (ORCA Lead → Worker)**: tombol "Kerjakan sebagai tim" di composer project; Lead (Hermes) merencanakan dan membagi tugas ke Worker (omp) paralel sampai batas tim; panel Progres menampilkan pohon Lead → tugas → Worker; persetujuan izin agregat dan tombol hentikan per-anggota/seluruh tim. Tidak ada auto-merge; pemilik memutuskan di luar tim.
- **dsh** sebagai pilihan mesin pratinjau (label "Pratinjau", tooltip "belum diaudit"): butuh `DSH_COMMAND` dikonfigurasi di server, muncul di `GET /engines` bila jabat tangan ACP berhasil.
- Rekaman nyata adapter Hermes (7 skenario, Hermes 0.22.5) menggantikan asumsi sebelumnya; dua temuan penting dicatat di `docs/ADAPTER_EVENTS.md`: Hermes tidak menghentikan tool yang berjalan saat koneksi diputus, dan `hermes.tool.progress` tidak pernah melapor gagal (galat masuk ke teks jawaban).
- Android: panel izin baru (deskripsi lengkap, folder kerja, tiga tombol dengan target sentuh 48 dp, satu pengumuman TalkBack), panel Progres (fixture sama dengan desktop), cap build (`BuildConfig.BUILD_COMMIT`) di layar Tentang.

### Diperbaiki

- **Balapan `review.apply` vs run selesai** (worker): klien yang melihat run "selesai" lalu langsung menerima/menolak hasil bisa ditolak diam-diam (`run_active`) tanpa worktree pernah terhapus. Flag internal kini berubah serentak dengan event penutup, bukan menunggu pembersihan proses selesai.
- Tes harness dsh (`dshTestIdentity`) yang salah mensimulasikan "bukan root" saat benar-benar dijalankan sebagai root di Linux (ditemukan saat verifikasi gerbang P8; tidak memengaruhi kode produksi).
- Deretan perbaikan bug kecil P3 (lebar input `TextField`, label kuota sidebar, keterangan model dari data server, pemilih model dinonaktifkan untuk Hermes, xterm menunggu font siap) dan P4b (mesin dipaksa, chip agent di Topbar, `ProjectList` mati dihapus).

### Diketahui

- dsh sebagai root belum terbukti bekerja ujung-ke-ujung di CI Docker/VPS produksi (hanya diverifikasi di satu mesin pengembangan Linux dengan kendala tata letak folder yang spesifik mesin itu). Hermes dan dsh **nyata** (bukan tiruan) belum pernah dicoba dalam alur pengguna lengkap sejak P5 (Hermes) dan sama sekali (dsh). Lihat `docs/BACKLOG.md` "Ringkasan status gerbang P8" untuk daftar lengkap blocker/penting/nanti.
- Belum digabung ke `main`; tag rilis dan deploy VPS **belum dilakukan** (lihat `docs/RELEASE_NOTES.md`).

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
