# Design System — Personal AI OS

Arah visualnya: alat kerja yang hidup tapi tetap rapi, padat informasi, dan presisi, seperti editor kode yang rapi, bukan halaman pemasaran. Palet **Electric Slate** (referensi pemilik "Electric Cyberpunk Slate"): navy slate sebagai dasar, satu aksen cyan elektrik, teal dan emerald untuk informasi dan status, tipografi Geist (IBM Plex sebagai cadangan), dan batas tipis sebagai pengganti bayangan. Sejak pembaruan tampilan pasca 1.0.1 (pilihan pemilik: "hidup tapi tetap rapi"), aksen boleh bercahaya dan bergradien satu warna di titik-titik penting, dan gerak boleh sedikit memegas; lihat bagian Efek.

## Prinsip

1. **Konten dulu.** Teks chat, diff, dan kode adalah tokoh utama. Chrome UI mundur.
2. **Satu aksen.** Cyan hanya untuk aksi utama, fokus, dan status sedang berjalan. Maksimal satu elemen beraksen kuat per layar.
3. **Struktur dari garis, bukan kartu.** Panel dipisah border 1px. Bayangan hanya untuk elemen melayang (menu, dialog, toast).
4. **Padat tapi lega.** Desktop memakai baris 32px dan teks 13px. Android memakai target sentuh 48dp.
5. **Setiap state didesain.** Kosong, memuat, error, offline, dan tanpa izin wajib punya tampilan.

## Daftar larangan anti AI slop

| Jangan                                                             | Gantinya                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gradien ungu-biru, gradien multiwarna, teks bergradien, latar blob | Gradien hanya dari token aksen dan token status (`accent`, `thinking`, `tool`, `writing`, `done`, `error` beserta varian soft/on); tanpa warna literal atau token lain. Dipakai di tombol primer, item aktif, kilau status, dan cahaya layar sambutan                            |
| Glassmorphism dan blur dekoratif                                   | Permukaan solid dengan border tipis. Blur hanya pada lapisan melayang (palet perintah, toast, header lengket, panel samping yang menimpa), lewat kelas `.aios-blur`, maks 16 px (`--aios-blur`), tidak pernah di belakang teks isi jawaban                                       |
| Kartu membulat besar dengan bayangan di mana-mana                  | Daftar dan panel bergaris, radius dari himpunan 8/12/16/24; bayangan lembut hanya saat kartu interaktif di-hover (terangkat 1–2px)                                                                                                                                               |
| Ikon kilau dan emoji di UI                                         | Ikon Lucide garis 1.5, hanya bila memperjelas                                                                                                                                                                                                                                    |
| Hero besar yang mendorong composer keluar layar, sapaan berlebihan | Layar sambutan ringkas di chat kosong (cahaya aksen kecil, satu kalimat kerja, kartu saran); composer tetap terlihat dan langsung fokus                                                                                                                                          |
| Semua tombol primer                                                | Satu tombol primer per area, sisanya sekunder atau ghost                                                                                                                                                                                                                         |
| Animasi pantul berulang dan stagger panjang                        | Transisi 80–640 ms; pegas ringan (overshoot kecil, sekali) untuk elemen yang muncul dan pegas fisik untuk elemen yang berpindah; stagger maksimal 4 elemen × 40 ms. Animasi tak berhingga (kilau, denyut) hanya dengan siklus ≥ 1400 ms dan berhenti di `prefers-reduced-motion` |
| Copy generik ("Lepaskan potensimu")                                | Kalimat kerja yang spesifik, kata kerja di depan                                                                                                                                                                                                                                 |
| Font default sistem campur-aduk                                    | Geist dan Geist Mono, IBM Plex Sans dan IBM Plex Mono hanya sebagai cadangan                                                                                                                                                                                                     |
| Spinner di tengah layar kosong                                     | Skeleton sesuai bentuk konten                                                                                                                                                                                                                                                    |

## Token warna (OKLCH)

Sumber tunggal: `packages/ui-tokens/tokens.json` (dibangkitkan ke CSS dan Kotlin). Tema gelap diambil dari hex referensi (bg `#0b1326`, aksen `#4cd7f6`, teal `#4fdbc8`, emerald `#4edea3`); tema terang diturunkan dari palet yang sama dengan cyan lebih gelap (`#0e7490`) agar teks putih di atas aksen tetap AA. Kontras diuji otomatis (`tokens.test.ts`).

| Token                        | Terang                                                       | Gelap                                                                         | Dipakai untuk                                                     |
| ---------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `bg`                         | oklch(0.978 0.006 255.5)                                     | oklch(0.19 0.041 265.5)                                                       | Latar aplikasi                                                    |
| `surface`                    | oklch(1 0 0)                                                 | oklch(0.225 0.039 266)                                                        | Panel, kartu jawaban AI, daftar                                   |
| `surface-2`                  | oklch(0.959 0.01 252.8)                                      | oklch(0.287 0.037 266.5)                                                      | Hover, gelembung pengguna, header blok kode                       |
| `border`                     | oklch(0.904 0.016 253.9)                                     | oklch(0.328 0.039 270)                                                        | Pemisah panel dan field                                           |
| `border-strong`              | oklch(0.826 0.024 256.1)                                     | oklch(0.407 0.039 259.9)                                                      | Field aktif, pemisah penting                                      |
| `text`                       | oklch(0.208 0.04 265.8)                                      | oklch(0.915 0.038 272.5)                                                      | Teks utama                                                        |
| `text-2`                     | oklch(0.446 0.037 257.3)                                     | oklch(0.827 0.015 218.1)                                                      | Teks sekunder, label                                              |
| `text-3`                     | oklch(0.524 0.037 258.4)                                     | oklch(0.68 0.025 250.2)                                                       | Meta, placeholder, jam pesan                                      |
| `accent`                     | oklch(0.52 0.094 223.1)                                      | oklch(0.817 0.124 215.7)                                                      | Aksi utama, fokus, sedang berjalan (cyan elektrik)                |
| `accent-soft`                | oklch(0.944 0.034 215)                                       | oklch(0.328 0.053 227.4)                                                      | Latar chip role, seleksi                                          |
| `success`                    | oklch(0.508 0.105 165.6)                                     | oklch(0.809 0.15 162.3)                                                       | Selesai, status online, baris tambah di diff (emerald)            |
| `warning`                    | oklch(0.626 0.125 70.4)                                      | oklch(0.843 0.141 85.5)                                                       | Butuh izin, kuota menipis                                         |
| `danger`                     | oklch(0.505 0.19 27.5)                                       | oklch(0.838 0.089 26.8)                                                       | Error, gagal, baris hapus di diff                                 |
| `info`                       | oklch(0.511 0.086 186.4)                                     | oklch(0.811 0.123 182.5)                                                      | Link, catatan (teal)                                              |
| `surface-1`                  | oklch(1 0 0)                                                 | oklch(0.225 0.039 266)                                                        | Lapisan 1 (sama dengan `surface`): panel, daftar                  |
| `surface-3`                  | oklch(0.945 0.012 252)                                       | oklch(0.305 0.036 266.5)                                                      | Lapisan 3 (paling tinggi): popover, item terpilih, header lengket |
| `thinking` / `-soft` / `-on` | oklch(0.5 0.15 295) / oklch(0.95 0.024 295) / oklch(1 0 0)   | oklch(0.78 0.12 295) / oklch(0.31 0.07 295) / oklch(0.19 0.041 265.5)         | Agent berpikir (violet)                                           |
| `tool` / `-soft` / `-on`     | oklch(0.5 0.1 75) / oklch(0.955 0.045 85) / oklch(1 0 0)     | oklch(0.843 0.141 85.5) / oklch(0.32 0.06 85) / oklch(0.19 0.041 265.5)       | Agent memakai tool (amber)                                        |
| `writing` / `-soft` / `-on`  | oklch(0.5 0.085 215) / oklch(0.95 0.03 215) / oklch(1 0 0)   | oklch(0.817 0.124 215.7) / oklch(0.328 0.053 227.4) / oklch(0.19 0.041 265.5) | Agent menulis jawaban (cyan)                                      |
| `done` / `-soft` / `-on`     | oklch(0.5 0.105 162) / oklch(0.95 0.04 162) / oklch(1 0 0)   | oklch(0.809 0.15 162.3) / oklch(0.31 0.06 162) / oklch(0.19 0.041 265.5)      | Selesai (emerald)                                                 |
| `error` / `-soft` / `-on`    | oklch(0.505 0.19 27.5) / oklch(0.95 0.022 25) / oklch(1 0 0) | oklch(0.838 0.089 26.8) / oklch(0.31 0.07 27) / oklch(0.19 0.041 265.5)       | Gagal (merah, solid sama dengan `danger`)                         |

Tiap warna status punya tiga varian: solid (penanda, titik, garis), soft (latar chip dan baris) dan on (teks di atas solid). Lapisan permukaan berurutan `bg` → `surface-1` → `surface-2` → `surface-3`, masing-masing dengan bayangan tipis (`shadow-layer-1..3`, Android `Tokens.Elevation.layer1..3`). `tokens.test.ts` menghitung kontras semua pasangan baru: teks ≥ 4.5:1 (`on` di atas solid, `text`/`text-2` di atas soft dan lapisan), elemen UI ≥ 3:1 (solid di atas `bg`, lapisan, dan soft-nya).

Tema mengikuti sistem secara default, dengan pilihan manual terang atau gelap. Android tidak memakai dynamic color Material You secara default agar identitas tetap konsisten.

## Tipografi

- **UI:** Geist, berat 400, 500, 600 saja (woff2 variabel, di-self-host di `apps/desktop/src/fonts`, lisensi OFL disertakan). Cadangan: IBM Plex Sans.
- **Kode, path, angka teknis:** Geist Mono. Cadangan: IBM Plex Mono. Android memakai Geist dan Geist Mono statis (ttf di `apps/android/app/src/main/res/font`, lisensi OFL di `apps/android/licenses`); IBM Plex tidak lagi dibundel di Android.
- Angka di tabel, diff stat, dan kuota memakai `font-variant-numeric: tabular-nums`.
- Lebar baca teks chat maksimal 72 karakter.

| Peran               | Desktop     | Android     | Line height |
| ------------------- | ----------- | ----------- | ----------- |
| Caption, label mono | 11 px       | 12 sp       | 1.4         |
| Meta                | 12 px       | 13 sp       | 1.4         |
| UI default          | 13 px       | 14 sp       | 1.45        |
| Isi chat            | 14 px       | 16 sp       | 1.6         |
| Judul bagian        | 16 px / 600 | 18 sp / 600 | 1.3         |
| Judul halaman       | 20 px / 600 | 22 sp / 600 | 1.25        |

## Spasi, radius, elevasi, gerak

- **Spasi:** kelipatan 4: 4, 8, 12, 16, 20, 24, 32, 40, 48.
- **Radius:** himpunan 8 / 12 / 16 / 24 px (token `sm`/`md`/`lg`/`xl`; nama peran di desktop: `rounded-badge` 8, `rounded-control` 12, `rounded-panel` 16, `rounded-sheet` 24). Bulat penuh untuk chip role, titik status, dan avatar. Android memakai himpunan yang sama dalam dp. `designLint.test.ts` menolak `rounded-*` di luar himpunan ini.
- **Elevasi:** satu token bayangan melayang untuk menu, popover, dialog, toast (`shadow-float`). Lapisan permukaan memakai bayangan tipis `shadow-layer-1..3`.
- **Gerak:** himpunan durasi 80 ms (`instant`, tekan), 120 ms (hover), 180 ms (panel), 240 ms (dialog dan sheet), 320 ms (`emphasis`), 420 ms (`long`, transisi layar), 640 ms (`extra`, urutan sinematik yang jarang). Kurva `cubic-bezier(0.2, 0, 0, 1)`; pegas ringan `cubic-bezier(0.34, 1.32, 0.64, 1)` untuk elemen yang muncul; **pegas fisik** (`dampingRatio` 0,7, `stiffness` 300; CSS `--aios-easing-spring-move` berupa `linear()` dengan durasi `--aios-duration-spring-move`, Compose `spring(...)`) untuk elemen yang berpindah posisi. Animasi tak berhingga (kilau, denyut) boleh dengan siklus minimal 1400 ms (`--aios-loop-min`) dan wajib berhenti di `prefers-reduced-motion`. Saat `prefers-reduced-motion`, hanya fade.
- **Efek:** cahaya aksen (`glow`, bayangan berwarna aksen transparan) untuk tombol primer saat hover, item aktif, indikator sedang menulis, dan cahaya layar sambutan; gradien dari token aksen dan status; kartu interaktif terangkat dengan bayangan lembut saat hover; blur hanya pada lapisan melayang (lihat daftar larangan). Tetap dilarang: gradien multiwarna di luar token, partikel, dan efek yang terus bergerak di area kerja selain indikator status.
- **Keyframe dasar** (`styles.css`, belum dipakai komponen): `aios-shimmer` (kilau teks status), `aios-pulse-ring` (cincin denyut), `aios-draw-in` (goresan SVG tergambar), semuanya dimatikan di `prefers-reduced-motion`.
- **Pola gerak yang dipakai** (desktop: utilitas `animate-aios-*` di `styles.css`; Android: `Tokens.Motion`): pesan baru muncul naik 4px sambil memudar (180 ms); jawaban yang sedang ditulis menampilkan tiga titik yang memudar bergiliran dan titik chip role beraksen yang berdenyut; menu dan tooltip muncul dari skala 0,98; dialog turun 6px (240 ms); toast naik 8px; pindah bagian memudar; penanda aktif rail dan percakapan berupa garis aksen 2px yang tumbuh dari tengah; tombol mengecil 2% saat ditekan; titik status yang sedang menyambung ulang berdenyut. Tanpa pantulan, tanpa stagger panjang.
- **Pembaruan gerak (2026-10-28, permintaan pemilik: lebih modern dan beranimasi):** tetap dalam batas di atas (durasi 120/180/240/320 ms, gradien hanya warna aksen, tanpa blur). Yang ditambah: sakelar dengan kenop yang meluncur dengan pegas ringan dan cahaya saat aktif; kerangka memuat dengan sapuan aksen tipis (`aios-shimmer`) menggantikan kedip; garis kemajuan tak tentu 2 px di tepi atas composer selama agent bekerja (`aios-progress`, indikator status); ikon langkah tool yang sedang berjalan berputar; tombol primer dan sekunder terangkat 1 px saat hover; tombol Arahkan/Antre muncul dengan skala 0,98 saat run coding berjalan; baris tabel Project masuk bertahap (maks. 4 × 40 ms). Semua mengikuti `prefers-reduced-motion` (animasi berhenti, tanpa perpindahan).
- **Fokus:** ring 2px warna `accent` dengan offset 2px, selalu terlihat saat navigasi keyboard.

## Layout Windows

Shell berupa **pulau** di atas kanvas gelap berlapis: kanvas `bg`, tiap pulau `surface-1` dengan radius 16 (`rounded-panel`), batas tipis, dan bayangan lapisan 1 (kelas `ISLAND` di `shell/island.ts`); jarak antar pulau dan ke tepi jendela 8 px (`--aios-island-gap`). Elemen terangkat di dalam pulau memakai `surface-2`.

- **Sidebar (pulau 232 px, ringkas 64 px):** merek, navigasi utama (ikon + label: Chat, Project, Kanban, Jadwal, Riset, Ruang, Pengaturan), lalu daftar konteks bagian aktif (percakapan, riset, jadwal). Ringkas (Ctrl+B) hanya ikon dengan tooltip; lebar bertransisi 240 ms. Penanda item aktif adalah **pelat yang meluncur** antar item (`PlateGroup`: posisi dihitung dari item aktif, transform 240 ms dengan kurva pegas token `--ease-spring-move`); pelat hover menyusul kursor (120 ms). Percakapan yang sedang berjalan diberi titik berpendar `writing` (`useLiveConversationIds`).
- **Area utama (pulau terbesar):** topbar 48 px (`--aios-topbar-height`) berisi judul layar (h1), di layar chat project aktif dan model, di kanan indikator koneksi (titik status + teks: tersambung, menyambung ulang, terputus/luring), aksi konteks bagian (Chat baru, Riset baru), dan tombol panel kanan. Di bawahnya banner koneksi (galat gateway dengan Coba lagi, atau luring) dan isi layar. Lebar isi layar non-chat satu token `--aios-page-measure` (720 px) lewat `PageContainer`.
- **Panel kanan (pulau, lebar bisa diubah, tab dengan ikon):** Preview, Diff, Terminal, Berkas, Git, Aktivitas. Tab aktif berlabel, lainnya ikon dengan tooltip dan nama aksesibel; penanda aktif meluncur seperti sidebar. Membuka melebar dari 0 ke lebar tersimpan dan menutup menyempit lagi (240 ms, CSS); panel baru dilepas setelah animasi tutup selesai. Pegangan ubah-lebar berada di celah antar pulau.
- **Kaki status 24 px** di kanvas: project dan branch, role aktif, model, status worker, kuota.
- **Perpindahan layar** memakai View Transitions API pada pembungkus isi (`.aios-page-transition`): cross-fade + geser 8 px, 180 ms; tanpa dukungan peramban atau saat `prefers-reduced-motion` tanpa animasi.
- **Keadaan shell:** memuat awal (`ShellSkeleton`: kerangka pulau dengan shimmer aksen, bukan layar kosong), galat koneksi gateway (banner dengan Coba lagi), luring (banner informasi), dan sukses.
- **Command palette** Ctrl+K untuk semua aksi: lapisan melayang (`surface-2`, radius 24, overlay dengan blur `.aios-blur`), masuk 180 ms naik 8 px + fade, hasil per grup dengan pintasan di tiap baris, fokus terkunci di dalam dan kembali ke pembuka saat ditutup.
- **Pintasan keyboard** (sumber kebenaran: kode; `apps/desktop/src/shell/navRoutes.ts` dan `useShortcuts.ts`): Ctrl+K palet perintah, Ctrl+N chat baru, Ctrl+B sidebar, Ctrl+J panel kanan, Ctrl+Shift+Spasi tanya cepat. Ctrl+1 Chat, Ctrl+2 Project, Ctrl+3 Kanban, Ctrl+4 Jadwal, Ctrl+5 Riset, Ctrl+6 Pengaturan (urutan sidebar). Petunjuk di palet diturunkan dari kode yang sama dan daftar di Pengaturan diuji terhadapnya; layar lain (Ruang, Kuota, Status, Pembanding) hanya lewat palet atau rail.

## Layout Android

- Bottom navigation: bilah **pil melayang** (`FloatingNavBar`) dengan 4 tujuan: Chat, Riset, Jadwal, Ruang. Penanda aktif meluncur dengan spring `MotionSpec`; ikon + label, tinggi item 56 dp (target sentuh ≥ 48 dp), peran Tab untuk TalkBack, memberi ruang untuk insets sistem. Pengaturan lewat ikon di top bar.
- Semua animasi Android membaca `MotionSpec` (`AiosTheme.motion`): bila animasi dimatikan di sistem (`ANIMATOR_DURATION_SCALE` = 0) animasi berhingga menjadi `snap()` dan animasi dekoratif tak berhingga (kilau, denyut, putar) tidak dijalankan.
- Composer menempel di bawah, naik bersama keyboard. Tombol suara di kiri, kirim di kanan.
- Daftar percakapan lewat drawer dari kiri.

## Komponen inti

| Komponen | Aturan |
| --- | --- |
| Pesan asisten | Tanpa kartu: avatar bot kecil di kiri (titik status: emerald selesai, cyan berdenyut saat menulis), baris meta redup (nama "Personal AI", chip role, model mono), isi langsung selebar `--aios-chat-measure` (72 karakter). Blok kode tetap berkartu |
| Pesan pengguna | Gelembung `accent-soft` rata kanan, radius panel dengan sudut kanan atas kecil; jam kirim kecil di dalam gelembung |
| Langkah tool | Chip kecil berderet (`rounded-control`, bergaris): ikon status, nama mono, target terpotong, durasi; bisa dibuka untuk target penuh |
| Agent HUD | Satu bilah lipat di atas composer: rencana agent (bilah kemajuan), antrean "Menunggu giliran" dengan tombol tarik, chip jumlah subagent (membuka tab Aktivitas). Hilang bila kosong. Pertanyaan dan izin agent tetap panel penuh inline |
| Composer | Kartu mengambang (`rounded-panel`, bayangan lift); garis aksen dan glow saat fokus; pil mode/model/skill; Kirim berubah jadi grup Hentikan/Antre/Arahkan saat run coding |
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
