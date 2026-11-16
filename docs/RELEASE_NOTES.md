# Catatan rilis — 1.1.0 (2026-11-15)

## Status: dipublikasikan sebagai tag `v1.1.0`

Kodenya **sudah digabung ke `main`** (`b26d61e`, 2026-11-13) dan mencakup sesi P1 sampai P11; tag `v1.1.0` diterbitkan lewat `infra/scripts/release.mjs` (build rilis di GitHub Actions). Gateway dari `b26d61e` (tag otomatis `v1.0.46`) sudah di-deploy ke VPS pada 2026-11-15 setelah backup (snapshot restic `0bed8dcf`): migrasi 0011–0017 diterapkan, `/v1/readyz` ok (Postgres, Hermes, 9Router, SearXNG). Deploy otomatis VPS (`aios-deploy.service`) sebelumnya gagal `203/EXEC` karena `auto-deploy.sh` tanpa bit eksekusi; diperbaiki di rilis ini. Versi metadata: desktop `1.1.0`, Android default `1.1.0` (`versionCode` 1001000).

## Apa yang baru, dalam bahasa pengguna

- **Tampilan baru**: sidebar, area chat, dan panel kanan sekarang tampil sebagai tiga "pulau" terpisah dengan jarak rapi dari tepi jendela, menggantikan tampilan sebelumnya.
- **Panel Progres**: saat agent bekerja, Anda bisa melihat rencananya (daftar langkah), hasil kerjanya (berkas, gambar, laporan), dan apa yang dia pakai (skill, memori, lampiran) — semua dalam satu panel, bisa dibuka ulang setelah selesai.
- **Jawaban yang lebih kaya**: agent sekarang bisa menjawab dengan tabel, grafik sederhana, dan daftar langkah yang rapi, bukan hanya teks biasa.
- **Bukti visual**: screenshot dan diagram yang dibuat agent muncul sebagai thumbnail yang bisa diklik untuk diperbesar.
- **Kerja tim AI** (di dalam project): Anda bisa meminta agent membagi satu tugas besar jadi beberapa bagian — satu agent "ketua" merencanakan dan meninjau, agent "pekerja" mengerjakan bagian-bagian itu satu per satu (saat ini satu pekerja pada satu waktu). Anda tetap yang memutuskan apakah hasilnya dipakai.
- **Pilihan mesin agent**: Anda bisa memaksa percakapan memakai mesin tertentu (otomatis, omp, Hermes, atau dsh — dsh masih berlabel "Pratinjau, belum diaudit").
- Android mendapat panel izin yang lebih jelas dan panel Progres yang sama dengan desktop.
- **Katalog skill** (P9): agent kini melihat daftar skill yang tersedia dan membuka sendiri yang ia perlukan, bukan dijejali semuanya. Panel Progres menunjukkan skill mana yang benar-benar dibuka.
- **Halaman Skill di desktop** (P10): Anda bisa membuat skill sendiri, mengubahnya, menonaktifkan atau mengarsipkannya, melihat riwayat versi, dan memulihkan versi lama. Skill juga bisa dipasang dari skills.sh atau GitHub dan diimpor dari Hermes; isinya ditampilkan dan dipindai dulu sebelum dipasang, dan hanya teks petunjuknya yang diunduh (skrip tidak pernah diunduh atau dijalankan).
- **Skill di Android** (P10): layar Skill di Pengaturan menampilkan daftar skill dengan sakelar aktif/nonaktif. Membuat, mengubah, memasang, dan impor tetap di desktop.
- **Usulan skill dari agent** (P11): agent (dan Hermes) bisa mengusulkan skill baru atau perbaikan skill. Usulan tidak pernah aktif sendiri — Anda yang memilih Setujui, Edit lalu setujui, atau Tolak di desktop.
- **Kurator skill mingguan** (P11): skill usulan agent yang tidak dibuka 30 hari ditandai usang dan setelah 90 hari diarsipkan (bisa dipulihkan); skill buatan Anda hanya ditandai; tidak ada yang pernah dihapus. Laporannya datang sebagai notifikasi.

## Yang diperbaiki

- Bug langka: kadang setelah agent coding selesai bekerja, menerima atau menolak hasilnya bisa gagal diam-diam dan folder kerja sementaranya tidak terhapus. Sudah diperbaiki dan diuji ulang puluhan kali tanpa gagal.
- Satu bug kecil di alat uji internal (tidak memengaruhi pengguna) ditemukan dan diperbaiki saat verifikasi menyeluruh sesi ini.
- Panel kerja tim kadang menampilkan "Tim selesai." tanpa satu tugas pun lalu berhenti memperbarui diri. Penyebabnya di server (status tim dilaporkan selesai sebelum rencana tersimpan) dan sudah diperbaiki.
- Skill publik yang sah kadang ditolak saat dipasang karena deskripsinya ditulis di beberapa baris; sekarang terbaca.
- Daftar skill Hermes terpotong diam-diam di 300 skill; sekarang batasnya 2000 dan pemotongan diberitahukan.

## Yang BELUM bisa dipastikan (jangan anggap siap pakai untuk ini)

- **dsh** (salah satu pilihan mesin) belum pernah benar-benar dicoba dengan program dsh sungguhan di mesin pengembangan mana pun — hanya diuji dengan tiruan. Jangan andalkan dsh untuk pekerjaan penting sampai ada verifikasi nyata.
- **Hermes** (mesin percakapan umum) hanya pernah diverifikasi nyata sekali, di sesi terpisah sebelumnya; alur pengguna lengkap versi ini belum dicoba dengan Hermes sungguhan, hanya tiruan.
- Uji beban di VPS produksi **belum pernah dijalankan** untuk versi ini. (Deploy dan backup sudah: lihat Status.)
- **Diketahui**: pemeriksaan `/v1/readyz` untuk 9Router butuh 1,3–1,9 detik di VPS, dekat batas `READY_TIMEOUT_MS` (2000 ms); pada 2026-11-15 satu pemeriksaan sempat gagal `timeout` sehingga `/v1/readyz` sekali menjawab 503 (pemeriksaan berikutnya 200).
- **Skill** (P9–P11): ketepatan agent memilih skill belum diukur ulang setelah perbaikan nama skill; petunjuk "usulkan skill" belum diuji dengan model sungguhan; kurator mingguan dan pemantau skill Hermes belum pernah berjalan di server produksi (hanya pendaftaran jadwalnya yang diuji); Android belum punya layar usulan skill.

## Bukti verifikasi (ringkas; detail lengkap di `docs/REPAIR_LOG.md` bagian "P8" dan `docs/BACKLOG.md` "Temuan P9" sampai "Temuan P11")

- Build, pemeriksaan tipe, dan gaya kode: bersih dari clone baru.
- Semua tes otomatis: dijalankan dua cara (sebagai pengguna biasa dan sebagai administrator sistem) — lulus, kecuali beberapa yang gagal karena keterbatasan mesin pengembangan ini sendiri (dicatat lengkap, bukan bug aplikasi).
- Alur lengkap di aplikasi (login, chat, kerja tim, panel Progres, hentikan, muat ulang): diuji otomatis tiga kali berturut-turut, dua kali lulus sempurna.
- Tampilan: dibandingkan dengan versi paling awal proyek ini secara otomatis; perubahan terlihat wajar sesuai fitur yang ditambahkan.
- Pemeriksaan kode secara menyeluruh untuk memastikan tidak ada berkas kode yang ditulis tapi tidak pernah dipakai: tidak ditemukan.
- Sesi skill (P9–P11), seperti dicatat di `docs/BACKLOG.md` "Temuan P11": pemeriksaan tipe 12 dari 12 paket, tes kontrak, gateway, dan desktop lulus, alur lengkap di aplikasi (e2e) lulus; pasang skill dari internet dan impor dari folder Hermes sungguhan dicoba nyata di mesin pengembangan.

## Paket rilis

Installer dan APK resmi ada di rilis GitHub [`v1.1.0`](https://github.com/Rizky0606/Personal-AI-OS/releases/tag/v1.1.0) (dibangun `build.yml` dari commit `1f36931`, diterbitkan 2026-11-15):

| Berkas | Isi | Ukuran (byte) |
| --- | --- | --- |
| `Personal.AI.OS_1.1.0_x64-setup.exe` | Installer Windows NSIS bertanda tangan updater | 34760754 |
| `Personal.AI.OS_1.1.0_x64-setup.exe.sig` | Tanda tangan updater untuk installer | 444 |
| `latest.json` | Manifes auto-update (versi `1.1.0`, platform `windows-x86_64`) | 720 |
| `app-release.apk` | APK Android rilis bertanda tangan (pasang yang ini) | 3042130 |
| `app-debug.apk` | APK Android debug (kunci acak CI, tidak bisa menimpa APK lain) | 16099088 |

## Deploy dan rollback

1. Tinjau ref/tag, migrasi, backup terbaru, readiness, ruang disk. Uji restore ke DB sementara; jangan gunakan DB produksi untuk tes.
2. Deploy gateway di VPS hanya lewat `infra/scripts/deploy.sh --ref vX.Y.Z`; skrip membackup, membangun image arm64, menjalankan migrasi, menunggu `/v1/readyz`, lalu mengembalikan image sebelumnya bila langkah gagal.
3. Rollback image tidak membatalkan migrasi database. Migrasi wajib kompatibel/aditif terhadap versi lama.
4. Bila data rusak, hentikan perubahan dan pulihkan snapshot melalui `infra/scripts/restore.sh` yang telah diuji. Verifikasi snapshot dan target database secara eksplisit; tindakan ini dapat mengubah data produksi.
5. Setelah deploy, periksa `/v1/readyz`, login, chat ringkas, redaksi log, worker, dan antrean.

Deploy gateway `v1.0.46` (kode `b26d61e`) dijalankan dengan prosedur di atas pada 2026-11-15; blocker dsh/Hermes nyata di atas diterima secara sadar oleh pemilik untuk rilis ini.
