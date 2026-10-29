# Design System — Personal AI OS

Arah visualnya: alat kerja yang hidup tapi tetap rapi, padat informasi, dan presisi, seperti editor kode yang rapi, bukan halaman pemasaran. Palet **Electric Slate** (referensi pemilik "Electric Cyberpunk Slate"): navy slate sebagai dasar, satu aksen cyan elektrik, teal dan emerald untuk informasi dan status, tipografi IBM Plex, dan batas tipis sebagai pengganti bayangan. Sejak pembaruan tampilan pasca 1.0.1 (pilihan pemilik: "hidup tapi tetap rapi"), aksen boleh bercahaya dan bergradien satu warna di titik-titik penting, dan gerak boleh sedikit memegas; lihat bagian Efek.

## Prinsip

1. **Konten dulu.** Teks chat, diff, dan kode adalah tokoh utama. Chrome UI mundur.
2. **Satu aksen.** Cyan hanya untuk aksi utama, fokus, dan status sedang berjalan. Maksimal satu elemen beraksen kuat per layar.
3. **Struktur dari garis, bukan kartu.** Panel dipisah border 1px. Bayangan hanya untuk elemen melayang (menu, dialog, toast).
4. **Padat tapi lega.** Desktop memakai baris 32px dan teks 13px. Android memakai target sentuh 48dp.
5. **Setiap state didesain.** Kosong, memuat, error, offline, dan tanpa izin wajib punya tampilan.

## Daftar larangan anti AI slop

| Jangan | Gantinya |
| --- | --- |
| Gradien ungu-biru, gradien multiwarna, teks bergradien, latar blob | Latar netral polos; gradien hanya satu warna aksen (cyan) di tombol primer, item aktif, dan cahaya layar sambutan |
| Glassmorphism dan blur dekoratif | Permukaan solid dengan border tipis |
| Kartu membulat besar dengan bayangan di mana-mana | Daftar dan panel bergaris, radius kecil; bayangan lembut hanya saat kartu interaktif di-hover (terangkat 1–2px) |
| Ikon kilau dan emoji di UI | Ikon Lucide garis 1.5, hanya bila memperjelas |
| Hero besar yang mendorong composer keluar layar, sapaan berlebihan | Layar sambutan ringkas di chat kosong (cahaya aksen kecil, satu kalimat kerja, kartu saran); composer tetap terlihat dan langsung fokus |
| Semua tombol primer | Satu tombol primer per area, sisanya sekunder atau ghost |
| Animasi pantul berulang dan stagger panjang | Transisi 120–320 ms; pegas ringan (overshoot kecil, sekali) untuk elemen yang muncul; stagger maksimal 4 elemen × 40 ms |
| Copy generik ("Lepaskan potensimu") | Kalimat kerja yang spesifik, kata kerja di depan |
| Font default sistem campur-aduk | IBM Plex Sans dan IBM Plex Mono saja |
| Spinner di tengah layar kosong | Skeleton sesuai bentuk konten |

## Token warna (OKLCH)

Sumber tunggal: `packages/ui-tokens/tokens.json` (dibangkitkan ke CSS dan Kotlin). Tema gelap diambil dari hex referensi (bg `#0b1326`, aksen `#4cd7f6`, teal `#4fdbc8`, emerald `#4edea3`); tema terang diturunkan dari palet yang sama dengan cyan lebih gelap (`#0e7490`) agar teks putih di atas aksen tetap AA. Kontras diuji otomatis (`tokens.test.ts`).

| Token | Terang | Gelap | Dipakai untuk |
| --- | --- | --- | --- |
| `bg` | oklch(0.978 0.006 255.5) | oklch(0.19 0.041 265.5) | Latar aplikasi |
| `surface` | oklch(1 0 0) | oklch(0.225 0.039 266) | Panel, kartu jawaban AI, daftar |
| `surface-2` | oklch(0.959 0.01 252.8) | oklch(0.287 0.037 266.5) | Hover, gelembung pengguna, header blok kode |
| `border` | oklch(0.904 0.016 253.9) | oklch(0.328 0.039 270) | Pemisah panel dan field |
| `border-strong` | oklch(0.826 0.024 256.1) | oklch(0.407 0.039 259.9) | Field aktif, pemisah penting |
| `text` | oklch(0.208 0.04 265.8) | oklch(0.915 0.038 272.5) | Teks utama |
| `text-2` | oklch(0.446 0.037 257.3) | oklch(0.827 0.015 218.1) | Teks sekunder, label |
| `text-3` | oklch(0.524 0.037 258.4) | oklch(0.68 0.025 250.2) | Meta, placeholder, jam pesan |
| `accent` | oklch(0.52 0.094 223.1) | oklch(0.817 0.124 215.7) | Aksi utama, fokus, sedang berjalan (cyan elektrik) |
| `accent-soft` | oklch(0.944 0.034 215) | oklch(0.328 0.053 227.4) | Latar chip role, seleksi |
| `success` | oklch(0.508 0.105 165.6) | oklch(0.809 0.15 162.3) | Selesai, status online, baris tambah di diff (emerald) |
| `warning` | oklch(0.626 0.125 70.4) | oklch(0.843 0.141 85.5) | Butuh izin, kuota menipis |
| `danger` | oklch(0.505 0.19 27.5) | oklch(0.838 0.089 26.8) | Error, gagal, baris hapus di diff |
| `info` | oklch(0.511 0.086 186.4) | oklch(0.811 0.123 182.5) | Link, catatan (teal) |

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
- **Radius:** 6 (badge), 8 (tombol, input), 16 (panel, kartu, dialog). Bulat penuh untuk chip role, titik status, dan avatar. Android: 8, 12, 16 dp.
- **Elevasi:** satu token bayangan untuk menu, popover, dialog, toast. Panel tidak berbayang.
- **Gerak:** 120 ms untuk hover dan tekan, 180 ms untuk panel, 240 ms untuk dialog dan sheet, 320 ms (`emphasis`) untuk animasi masuk yang menonjol. Kurva `cubic-bezier(0.2, 0, 0, 1)`; pegas ringan `cubic-bezier(0.34, 1.32, 0.64, 1)` untuk elemen yang muncul. Saat `prefers-reduced-motion`, hanya fade.
- **Efek:** cahaya aksen (`glow`, bayangan berwarna aksen transparan) untuk tombol primer saat hover, item aktif, indikator sedang menulis, dan cahaya layar sambutan; gradien satu warna aksen; kartu interaktif terangkat dengan bayangan lembut saat hover. Tetap dilarang: blur kaca, gradien multiwarna, partikel, dan efek yang terus bergerak di area kerja selain indikator status.
- **Pola gerak yang dipakai** (desktop: utilitas `animate-aios-*` di `styles.css`; Android: `Tokens.Motion`): pesan baru muncul naik 4px sambil memudar (180 ms); jawaban yang sedang ditulis menampilkan tiga titik yang memudar bergiliran dan titik chip role beraksen yang berdenyut; menu dan tooltip muncul dari skala 0,98; dialog turun 6px (240 ms); toast naik 8px; pindah bagian memudar; penanda aktif rail dan percakapan berupa garis aksen 2px yang tumbuh dari tengah; tombol mengecil 2% saat ditekan; titik status yang sedang menyambung ulang berdenyut. Tanpa pantulan, tanpa stagger panjang.
- **Pembaruan gerak (2026-10-28, permintaan pemilik: lebih modern dan beranimasi):** tetap dalam batas di atas (durasi 120/180/240/320 ms, gradien hanya warna aksen, tanpa blur). Yang ditambah: sakelar dengan kenop yang meluncur dengan pegas ringan dan cahaya saat aktif; kerangka memuat dengan sapuan aksen tipis (`aios-shimmer`) menggantikan kedip; garis kemajuan tak tentu 2 px di tepi atas composer selama agent bekerja (`aios-progress`, indikator status); ikon langkah tool yang sedang berjalan berputar; tombol primer dan sekunder terangkat 1 px saat hover; tombol Arahkan/Antre muncul dengan skala 0,98 saat run coding berjalan; baris tabel Project masuk bertahap (maks. 4 × 40 ms). Semua mengikuti `prefers-reduced-motion` (animasi berhenti, tanpa perpindahan).
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
| Pesan asisten | Kartu `surface` berbingkai, radius 16. Header: avatar bot dengan titik status (emerald selesai, cyan berdenyut saat menulis), nama "Personal AI", chip role, model mono. Teks sampai 72 karakter |
| Pesan pengguna | Gelembung `surface-2` rata kanan, radius 16 dengan sudut kanan atas kecil; jam kirim mono dan tanda terkirim di bawah teks |
| Langkah tool | Satu baris mono yang bisa dibuka: ikon, nama tool, target, status, durasi |
| Blok kode | Header berisi bahasa atau path file plus tombol salin; isi mono 12–13 px |
| Permintaan izin | Panel inline berwarna `warning`, berisi perintah persis, tombol Izinkan sekali, Selalu untuk project ini, Tolak |
| Chip role | Pil `accent-soft` dengan titik (cyan berdenyut saat menulis); klik pada jawaban terakhir membuka koreksi role |
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
