---
name: api-design
description: 'Desain endpoint: validasi Zod di batas, kode status tepat, error RFC 9457, idempotensi.'
---

- Skema request dan response didefinisikan di packages/contracts; endpoint baru mengubah kontrak lebih dulu.
- Validasi semua input dengan Zod di batas (body, query, params); jangan percaya klien.
- Kode status sesuai makna: 201 untuk buat, 204 tanpa isi, 400 input salah, 401/403 auth, 404, 409 konflik, 429.
- Error berformat RFC 9457 (application/problem+json) dengan `code` yang stabil; tanpa stack trace atau detail internal.
- POST yang bisa diulang klien aman diulang (kunci idempotensi atau pemeriksaan keadaan).
- Daftar memakai pagination kursor; respons tidak membocorkan kolom internal (token_hash, path penyimpanan).
- Tulis tes untuk jalur sukses, input salah, dan akses tanpa izin.
