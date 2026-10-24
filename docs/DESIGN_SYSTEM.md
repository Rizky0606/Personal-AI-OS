# Design System — Personal AI OS

Arah visualnya: alat kerja yang tenang, padat informasi, dan presisi, seperti editor kode yang rapi, bukan halaman pemasaran. Netral hangat sebagai dasar, satu aksen oranye bara yang dipakai hemat, tipografi IBM Plex, dan batas tipis sebagai pengganti bayangan.

## Prinsip

1. **Konten dulu.** Teks chat, diff, dan kode adalah tokoh utama. Chrome UI mundur.
2. **Satu aksen.** Oranye hanya untuk aksi utama, fokus, dan status sedang berjalan. Maksimal satu elemen beraksen kuat per layar.
3. **Struktur dari garis, bukan kartu.** Panel dipisah border 1px. Bayangan hanya untuk elemen melayang (menu, dialog, toast).
4. **Padat tapi lega.** Desktop memakai baris 32px dan teks 13px. Android memakai target sentuh 48dp.
5. **Setiap state didesain.** Kosong, memuat, error, offline, dan tanpa izin wajib punya tampilan.

## Daftar larangan anti AI slop

| Jangan | Gantinya |
| --- | --- |
| Gradien ungu-biru, teks bergradien, latar blob | Latar netral polos, aksen solid |
| Glassmorphism dan blur dekoratif | Permukaan solid dengan border tipis |
| Kartu membulat besar dengan bayangan di mana-mana | Daftar dan panel bergaris, radius kecil |
| Ikon kilau dan emoji di UI | Ikon Lucide garis 1.5, hanya bila memperjelas |
| Hero di tengah dengan sapaan besar "Halo, apa yang bisa saya bantu?" | Composer langsung siap ketik, saran singkat di bawahnya |
| Semua tombol primer | Satu tombol primer per area, sisanya sekunder atau ghost |
| Animasi pantul dan stagger panjang | Transisi 120–240 ms ease-out, tanpa pantulan |
| Copy generik ("Lepaskan potensimu") | Kalimat kerja yang spesifik, kata kerja di depan |
| Font default sistem campur-aduk | IBM Plex Sans dan IBM Plex Mono saja |
| Spinner di tengah layar kosong | Skeleton sesuai bentuk konten |

## Token warna (OKLCH)

Nilai di bawah adalah titik awal. Kontras wajib diverifikasi minimal WCAG AA saat implementasi.

| Token | Terang | Gelap | Dipakai untuk |
| --- | --- | --- | --- |
| `bg` | oklch(0.985 0.002 90) | oklch(0.17 0.005 90) | Latar aplikasi |
| `surface` | oklch(1 0 0) | oklch(0.20 0.005 90) | Panel, editor, daftar |
| `surface-2` | oklch(0.965 0.003 90) | oklch(0.24 0.006 90) | Hover, pesan pengguna, header blok kode |
| `border` | oklch(0.91 0.004 90) | oklch(0.30 0.006 90) | Pemisah panel dan field |
| `border-strong` | oklch(0.84 0.005 90) | oklch(0.38 0.006 90) | Field aktif, pemisah penting |
| `text` | oklch(0.22 0.01 90) | oklch(0.94 0.005 90) | Teks utama |
| `text-2` | oklch(0.45 0.01 90) | oklch(0.72 0.006 90) | Teks sekunder, label |
| `text-3` | oklch(0.54 0.008 90) | oklch(0.62 0.006 90) | Meta, placeholder |
| `accent` | oklch(0.58 0.165 45) | oklch(0.72 0.15 50) | Aksi utama, fokus, sedang berjalan |
| `accent-soft` | oklch(0.95 0.04 45) | oklch(0.30 0.06 45) | Latar chip aktif, seleksi |
| `success` | oklch(0.60 0.13 150) | oklch(0.72 0.13 150) | Selesai, tes lulus, baris tambah di diff |
| `warning` | oklch(0.75 0.15 80) | oklch(0.80 0.14 80) | Butuh izin, kuota menipis |
| `danger` | oklch(0.58 0.19 27) | oklch(0.68 0.17 27) | Error, gagal, baris hapus di diff |
| `info` | oklch(0.60 0.12 240) | oklch(0.72 0.11 240) | Link, catatan |

Tema mengikuti sistem secara default, dengan pilihan manual terang atau gelap. Android tidak memakai dynamic color Material You secara default agar identitas tetap konsisten.

## Tipografi

- **UI:** IBM Plex Sans, berat 400, 500, 600 saja.
- **Kode, path, angka teknis:** IBM Plex Mono.
- Angka di tabel, diff stat, dan kuota memakai `font-variant-numeric: tabular-nums`.
- Lebar baca teks chat maksimal 72 karakter.

| Peran | Desktop | Android | Line height |
| --- | --- | --- | --- |
| Caption, label mono | 11 px | 12 sp | 1.4 |
| Meta | 12 px | 13 sp | 1.4 |
| UI default | 13 px | 14 sp | 1.45 |
| Isi chat | 14 px | 16 sp | 1.6 |
| Judul bagian | 16 px / 600 | 18 sp / 600 | 1.3 |
| Judul halaman | 20 px / 600 | 22 sp / 600 | 1.25 |

## Spasi, radius, elevasi, gerak

- **Spasi:** kelipatan 4: 4, 8, 12, 16, 20, 24, 32, 40, 48.
- **Radius:** 4 (badge, chip), 6 (tombol, input), 10 (panel, dialog). Bulat penuh hanya untuk avatar dan titik status. Android: 8, 12, 16 dp.
- **Elevasi:** satu token bayangan untuk menu, popover, dialog, toast. Panel tidak berbayang.
- **Gerak:** 120 ms untuk hover dan tekan, 180 ms untuk panel, 240 ms untuk dialog dan sheet. Kurva `cubic-bezier(0.2, 0, 0, 1)`. Saat `prefers-reduced-motion`, hanya fade.
- **Pola gerak yang dipakai** (desktop: utilitas `animate-aios-*` di `styles.css`; Android: `Tokens.Motion`): pesan baru muncul naik 4px sambil memudar (180 ms); jawaban yang sedang ditulis menampilkan tiga titik yang memudar bergiliran dan titik chip role beraksen yang berdenyut; menu dan tooltip muncul dari skala 0,98; dialog turun 6px (240 ms); toast naik 8px; pindah bagian memudar; penanda aktif rail dan percakapan berupa garis aksen 2px yang tumbuh dari tengah; tombol mengecil 2% saat ditekan; titik status yang sedang menyambung ulang berdenyut. Tanpa pantulan, tanpa stagger panjang.
- **Fokus:** ring 2px warna `accent` dengan offset 2px, selalu terlihat saat navigasi keyboard.

## Layout Windows

- **Rail kiri 56px:** ikon Chat, Project, Kanban, Jadwal, Riset, Pengaturan.
- **Sidebar 260px** (bisa diciutkan): daftar percakapan atau project.
- **Area utama:** chat atau kanban.
- **Panel kanan** (bisa diubah lebarnya, tab): Preview, Diff, Terminal, Berkas.
- **Status bar 24px:** project dan branch, role aktif, model, status worker, kuota.
- **Command palette** Ctrl+K untuk semua aksi.

## Layout Android

- Bottom navigation 3 tab: Chat, Riset, Jadwal. Pengaturan lewat ikon di top bar.
- Composer menempel di bawah, naik bersama keyboard. Tombol suara di kiri, kirim di kanan.
- Daftar percakapan lewat drawer dari kiri.

## Komponen inti

| Komponen | Aturan |
| --- | --- |
| Pesan asisten | Tanpa gelembung. Teks penuh lebar sampai 72 karakter. Chip role dan model kecil di atasnya |
| Pesan pengguna | Blok `surface-2`, rata kanan, radius 10 |
| Langkah tool | Satu baris mono yang bisa dibuka: ikon, nama tool, target, status, durasi |
| Blok kode | Header berisi bahasa atau path file plus tombol salin; isi mono 12–13 px |
| Permintaan izin | Panel inline berwarna `warning`, berisi perintah persis, tombol Izinkan sekali, Selalu untuk project ini, Tolak |
| Chip role | Teks kecil + titik warna netral; klik membuka pemilih role |
| Kartu kanban | Judul, chip role, titik status, branch, diff stat mono (+12 −3) |
| Diff | Tampilan split atau unified, komentar per baris, tombol Terima dan Tolak per file dan semua |
| Toast | Pojok kanan bawah, 4 detik, maksimal 3 bertumpuk |
| Empty state | Satu kalimat apa yang bisa dilakukan + satu tombol aksi. Tanpa ilustrasi besar |

## Copy dan suara

- Bahasa Indonesia ringkas, kata kerja di depan: "Kerjakan dengan AI", "Terima perubahan", "Hubungkan ulang".
- Pesan error menyebut apa yang gagal dan langkah berikutnya, tanpa menyalahkan pengguna.
- Istilah teknis tetap Inggris bila lazim: branch, diff, commit, worktree.

## Skill UI Skills yang dipakai agent

Skill berikut dari registri ui-skills.com dimuat oleh role frontend dan dipakai sebagai checklist review:

- `ibelick/baseline-ui` untuk merapikan spasi, hierarki, dan tipografi.
- `jakubkrehel/better-colors` untuk token OKLCH dan kontras.
- `jakubkrehel/better-typography` untuk skala dan detail teks.
- `emilkowalski/emil-design-eng` untuk polish komponen dan gerak.
- `pbakaus/harden` untuk empty, error, dan edge state.
- `rams-design/rams` atau `jakubkrehel/better-interface` untuk review akhir.
- `vercel-labs/web-design-guidelines` untuk audit desktop.
