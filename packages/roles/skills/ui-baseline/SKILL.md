---
name: ui-baseline
description: 'Dasar UI: token design system, spasi kelipatan 4, hierarki, tipografi, gerak, dan larangan anti AI slop.'
---

Token dan warna

- Pakai hanya token dari packages/ui-tokens; tidak ada hex, ukuran, atau radius acak di komponen.
- Satu warna aksen per tampilan; satu tombol primer per area, aksi lain sekunder atau ghost.
- Satu warna = satu makna, dan warna tidak pernah menjadi satu-satunya penanda.
- Komponen memakai token semantik, bukan token primitif.

Spasi, hierarki, tipografi

- Spasi kelipatan 4; jarak antarbagian konsisten; hierarki lewat ukuran dan bobot, bukan dekorasi.
- Skala tipe kecil dan bernama; line-height tanpa satuan (body ~1,5); baris teks panjang maksimal 72 karakter.
- Angka yang berubah memakai tabular numerals; judul pendek diseimbangkan (text-wrap: balance); potong teks hanya dengan cara membaca versi penuhnya.
- Hanya IBM Plex Sans dan IBM Plex Mono.

Gerak

- Gerak hanya bila punya tujuan (umpan balik, perubahan state); transisi 120–240 ms ease-out, hanya transform dan opacity.
- Hormati prefers-reduced-motion: buang gerakan, sisakan fade halus.
- Tanpa animasi pantul atau stagger panjang.

Larangan anti AI slop

- Tanpa gradien ungu-biru atau teks bergradien, glassmorphism, blur dekoratif, blob, kartu membulat besar berbayangan, emoji atau ikon kilau di UI.
- Tanpa hero sapaan besar: composer langsung siap ketik. Tanpa spinner di layar kosong: pakai skeleton sesuai bentuk konten.
- Copy spesifik dengan kata kerja di depan; bukan slogan generik.
