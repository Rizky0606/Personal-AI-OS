---
name: security-basics
description: Pemeriksaan keamanan dasar untuk kode dan konfigurasi.
---

- Rahasia: tidak ada kunci, token, atau kata sandi di kode, log, atau commit; .env tidak ikut.
- Autentikasi dan otorisasi diperiksa di setiap endpoint, termasuk scope token.
- Input: injeksi SQL/perintah/path, XSS, SSRF, dan deserialisasi tidak aman.
- Dependensi baru: periksa kebutuhan, kepemilikan paket, dan kerentanan yang diketahui.
- Port internal (database, 9Router, Hermes) tidak terbuka ke publik.
- Respons dan log tidak membocorkan data pribadi atau detail internal.
- Perintah yang mengubah sistem, menghapus file, atau mengakses jaringan lewat persetujuan.
- Laporkan temuan dengan tingkat risiko dan langkah perbaikan; jangan menjalankan eksploit.
