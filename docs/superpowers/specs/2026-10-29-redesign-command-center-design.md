# Perombakan tampilan: Command Center (desktop dan Android)

Disetujui pemilik pada 2026-10-29 ("lakukan perubahan semuanya, desktop dan mobile"). Arah A dari tiga opsi (A Command Center, B Mission Board, C Focus Minimal).

## Tujuan

Tampilan lebih modern dan lega tanpa mengubah fitur atau alur: navigasi tunggal, chat tanpa kartu berbingkai, panel agent yang tidak menumpuk, gerak halus. Palet Electric Slate, font IBM Plex, dan aksen cyan tetap.

## Keputusan

| Bidang | Sebelum | Sesudah |
| --- | --- | --- |
| Navigasi desktop | Rail 56 px + sidebar 260 px | Satu sidebar 232 px (cari Ctrl+K, bagian utama, daftar konteks, kartu status); ciut jadi 64 px (ikon) |
| Status | Status bar 24 px | Dihapus; branch dan status run di header 48 px, worker dan kuota di kaki sidebar |
| Header | 40 px, judul | 48 px: breadcrumb project/branch, pil status run, tombol panel |
| Radius | desktop 6/8/16, Android 8/12/16 | desktop 8/10/14 (badge 6, kontrol 10, panel 14), Android 10/14/20 |
| Jawaban AI | Kartu berbingkai dengan bayangan | Tanpa kartu: avatar kiri, teks langsung; pesan pengguna gelembung aksen |
| Langkah tool | Baris mono terbuka | Chip kecil berderet |
| Rencana, subagent, antrean | Bertumpuk di antara pesan | Satu Agent HUD yang bisa dilipat tepat di atas composer; pertanyaan agent tetap panel penuh |
| Composer | Kotak dengan garis | Kartu mengambang, garis aksen saat fokus, tombol Arahkan/Antre bertransformasi dari Kirim |
| Panel kanan | Tab teks | Tab pil bersegmen dengan ikon |
| Gerak | 120-320 ms | Sama (120/180/240/320), ditambah layout animation daftar dan transisi layar; berhenti saat reduced-motion |
| Android | Bottom nav 3 tab, kartu | Bottom nav pil, kartu tanpa bingkai tebal, radius baru, composer mengambang |

## Batas yang tidak dilanggar

- Nama token tetap (`radius sm/md/lg`, `shadow float/glow/lift`, durasi 120/180/240/320, 14 warna); hanya nilai radius dan layout yang berubah. Tanpa warna hex di komponen, tanpa gradien selain satu warna aksen, tanpa blur kaca.
- Kontras AA, fokus terlihat, navigasi keyboard, empat keadaan per layar (memuat, kosong, error, offline).
- Jalan pintas tetap: Ctrl+K, N, B, J, 1..6.
- Android: tidak ada JDK di PC pengembang, jadi perubahan dibatasi pada tema (token, bentuk) dan modifikasi komposabel yang aman; diverifikasi CI.

## Tahapan (satu commit tiap tahap)

1. Token dan generator (selesai di tahap ini).
2. Shell desktop.
3. Chat dan Agent HUD.
4. Panel kanan dan layar lain.
5. Android.
6. `DESIGN_SYSTEM.md`, `designLint.test.ts`, tes.
