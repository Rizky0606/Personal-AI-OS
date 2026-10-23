---
name: safe-migrations
description: 'Migrasi database yang aman: maju-mundur, bertahap, backfill terpisah.'
---

- Satu migrasi, satu tujuan; sertakan cara mundur atau jelaskan mengapa tidak bisa.
- Jangan menghapus atau mengganti nama kolom dalam satu langkah: tambah, ganti pemakaian, lalu hapus di rilis berikutnya.
- Kolom baru NOT NULL harus punya DEFAULT atau diisi bertahap; hindari penguncian tabel besar.
- Backfill data berada di langkah terpisah dari perubahan skema, dan bisa diulang dengan aman.
- Jalankan migrasi di database uji dari nol dan dari keadaan sebelumnya; periksa hasilnya.
- Cadangkan sebelum migrasi yang destruktif dan minta persetujuan pemilik.
- Skema dan kontrak API tetap selaras; perbarui tes yang membandingkannya.
