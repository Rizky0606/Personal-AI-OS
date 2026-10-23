---
name: a11y-check
description: 'Checklist aksesibilitas: label, fokus, urutan tab, kontras AA, target sentuh, dan warna bukan satu-satunya penanda.'
---

- Setiap kontrol punya label yang terbaca pembaca layar; tombol hanya-ikon wajib punya nama aksesibel.
- Fokus selalu terlihat (jangan menghapus outline tanpa pengganti); urutan tab mengikuti urutan visual.
- Semua yang bisa diklik bisa dicapai dan dioperasikan dengan keyboard; pakai elemen semantik (button, a, input) dulu, ARIA belakangan.
- Kontras teks minimal AA (4,5:1; teks besar 3:1), diukur pada permukaan tempat teks tampil.
- Target sentuh minimal 44px (web) atau 48dp (Android); jarak antar target cukup.
- Status (error, sukses, aktif) tidak hanya dibedakan dengan warna; tambahkan teks atau ikon.
- Error form ditautkan ke field-nya dan diumumkan; input mempertahankan nilai saat error.
- Tingkat judul tidak melompat; gambar bermakna punya teks alternatif, gambar dekoratif dikosongkan.
- Hormati prefers-reduced-motion dan ukuran teks pengguna.
- Laporkan hasil pemeriksaan: yang lolos, yang gagal, dan yang tidak bisa diuji.
