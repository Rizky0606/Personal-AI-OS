# Catatan rilis — 1.1.0 (2026-11-08)

## Status: belum siap dipublikasikan

Ini catatan kesiapan, bukan rilis yang sudah dipublikasikan. Belum ada tag `v1.1.0`, belum ada deploy ke VPS, dan belum digabung ke `main`. Versi metadata: desktop `1.1.0`, Android default `1.1.0` (`versionCode` 1001000).

## Apa yang baru, dalam bahasa pengguna

- **Tampilan baru**: sidebar, area chat, dan panel kanan sekarang tampil sebagai tiga "pulau" terpisah dengan jarak rapi dari tepi jendela, menggantikan tampilan sebelumnya.
- **Panel Progres**: saat agent bekerja, Anda bisa melihat rencananya (daftar langkah), hasil kerjanya (berkas, gambar, laporan), dan apa yang dia pakai (skill, memori, lampiran) — semua dalam satu panel, bisa dibuka ulang setelah selesai.
- **Jawaban yang lebih kaya**: agent sekarang bisa menjawab dengan tabel, grafik sederhana, dan daftar langkah yang rapi, bukan hanya teks biasa.
- **Bukti visual**: screenshot dan diagram yang dibuat agent muncul sebagai thumbnail yang bisa diklik untuk diperbesar.
- **Kerja tim AI** (di dalam project): Anda bisa meminta agent membagi satu tugas besar jadi beberapa bagian dan mengerjakannya secara paralel — satu agent "ketua" merencanakan, agent "pekerja" mengerjakan. Anda tetap yang memutuskan apakah hasilnya dipakai.
- **Pilihan mesin agent**: Anda bisa memaksa percakapan memakai mesin tertentu (otomatis, omp, Hermes, atau dsh — dsh masih berlabel "Pratinjau, belum diaudit").
- Android mendapat panel izin yang lebih jelas dan panel Progres yang sama dengan desktop.

## Yang diperbaiki

- Bug langka: kadang setelah agent coding selesai bekerja, menerima atau menolak hasilnya bisa gagal diam-diam dan folder kerja sementaranya tidak terhapus. Sudah diperbaiki dan diuji ulang puluhan kali tanpa gagal.
- Satu bug kecil di alat uji internal (tidak memengaruhi pengguna) ditemukan dan diperbaiki saat verifikasi menyeluruh sesi ini.

## Yang BELUM bisa dipastikan (jangan anggap siap pakai untuk ini)

- **dsh** (salah satu pilihan mesin) belum pernah benar-benar dicoba dengan program dsh sungguhan di mesin pengembangan mana pun — hanya diuji dengan tiruan. Jangan andalkan dsh untuk pekerjaan penting sampai ada verifikasi nyata.
- **Hermes** (mesin percakapan umum) hanya pernah diverifikasi nyata sekali, di sesi terpisah sebelumnya; alur pengguna lengkap versi ini belum dicoba dengan Hermes sungguhan, hanya tiruan.
- Deploy ke server, backup/restore data, dan uji beban di VPS produksi **belum pernah dijalankan** untuk versi ini.
- Instalasi Windows (aplikasi desktop) dan APK Android rilis (bertanda tangan) **belum dibuat** — hanya tersedia build debug untuk pengujian internal, disimpan di luar repo, belum pernah dibagikan.

## Bukti verifikasi (ringkas; detail lengkap di `docs/REPAIR_LOG.md` bagian "P8")

- Build, pemeriksaan tipe, dan gaya kode: bersih dari clone baru.
- Semua tes otomatis: dijalankan dua cara (sebagai pengguna biasa dan sebagai administrator sistem) — lulus, kecuali beberapa yang gagal karena keterbatasan mesin pengembangan ini sendiri (dicatat lengkap, bukan bug aplikasi).
- Alur lengkap di aplikasi (login, chat, kerja tim, panel Progres, hentikan, muat ulang): diuji otomatis tiga kali berturut-turut, dua kali lulus sempurna.
- Tampilan: dibandingkan dengan versi paling awal proyek ini secara otomatis; perubahan terlihat wajar sesuai fitur yang ditambahkan.
- Pemeriksaan kode secara menyeluruh untuk memastikan tidak ada berkas kode yang ditulis tapi tidak pernah dipakai: tidak ditemukan.

## Paket dan checksum (disiapkan, TIDAK dipublikasikan)

Disimpan di luar repo (`/home/ubuntu/.hermes/cache/scratch/p8-artifacts/`), bukan artefak rilis resmi (tanpa tanda tangan, tanpa installer):

| Berkas | Isi | SHA-256 |
| --- | --- | --- |
| `desktop-dist-1.1.0.tar.gz` | Frontend desktop hasil build (`apps/desktop/dist`), bukan installer Tauri bertanda tangan | `fc04dc80a61a52735c96476ea68d8b25a783dfda5795891220b7d27a8a9abf18` |
| `android-debug-1.1.0.apk` | APK debug Android (bukan rilis bertanda tangan) | `c0bc8da3cd9163141da5221a3cc7b9b272f8095176b4bf2fe8b58c9f0cd7e7e9` |

## Deploy dan rollback (prosedur saja; belum dijalankan untuk versi ini)

1. Tinjau ref/tag, migrasi, backup terbaru, readiness, ruang disk. Uji restore ke DB sementara; jangan gunakan DB produksi untuk tes.
2. Deploy gateway di VPS hanya lewat `infra/scripts/deploy.sh --ref vX.Y.Z`; skrip membackup, membangun image arm64, menjalankan migrasi, menunggu `/v1/readyz`, lalu mengembalikan image sebelumnya bila langkah gagal.
3. Rollback image tidak membatalkan migrasi database. Migrasi wajib kompatibel/aditif terhadap versi lama.
4. Bila data rusak, hentikan perubahan dan pulihkan snapshot melalui `infra/scripts/restore.sh` yang telah diuji. Verifikasi snapshot dan target database secara eksplisit; tindakan ini dapat mengubah data produksi.
5. Setelah deploy, periksa `/v1/readyz`, login, chat ringkas, redaksi log, worker, dan antrean.

**Tidak ada langkah publikasi, tag, atau deploy yang dijalankan untuk catatan ini.** Jangan jalankan `infra/scripts/release.mjs` atau `infra/scripts/deploy.sh` sampai blocker di atas (dsh/Hermes nyata, deploy/backup belum pernah dicoba) diselesaikan atau diterima secara sadar oleh pemilik.
