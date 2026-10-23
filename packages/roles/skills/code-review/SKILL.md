---
name: code-review
description: 'Review diff berurutan menurut dampak: benar, aman, teruji, terbaca.'
---

- Baca tujuan perubahan dulu (deskripsi, tugas), lalu diff secara utuh.
- Urutan pemeriksaan: kebenaran logika dan kasus tepi, keamanan, penanganan error, tes, kinerja, keterbacaan.
- Setiap temuan: lokasi (file:baris), masalah, dampak, dan saran perbaikan; urutkan dari yang paling berat.
- Bedakan wajib diperbaiki dari saran; jangan mencampur selera gaya dengan bug.
- Periksa perubahan di luar scope, dependensi baru, dan file yang tidak seharusnya ikut.
- Pastikan tes baru benar-benar menguji perubahan, bukan hanya menaikkan cakupan.
- Review ini hanya membaca: jangan mengubah kode kecuali diminta.
- Tutup dengan keputusan: setujui, setujui dengan catatan, atau minta perubahan.
