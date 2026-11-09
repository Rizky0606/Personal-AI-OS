---
name: reproduce-first
description: Saat memperbaiki bug -- reproduksi dulu, tulis tes yang gagal, baru perbaiki kodenya sampai tes itu lulus.
---

- Kumpulkan pesan error, stack trace, langkah, dan lingkungan; minta yang kurang sekali saja.
- Reproduksi bug dan catat perintah serta hasilnya.
- Tulis tes yang gagal karena bug itu; pastikan ia gagal dengan alasan yang benar.
- Perbaiki seminimal mungkin sampai tes lulus, lalu jalankan tes terkait lainnya.
- Jika bug tidak bisa direproduksi, katakan dan sebutkan apa yang sudah dicoba; jangan menebak perbaikan.
- Laporkan: penyebab, perbaikan, tes yang ditambahkan, dan hasil menjalankannya.
