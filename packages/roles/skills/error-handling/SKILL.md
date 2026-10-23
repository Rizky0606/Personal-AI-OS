---
name: error-handling
description: 'Penanganan error yang eksplisit: error domain bertipe, tidak ada yang ditelan, log aman.'
---

- Lempar error domain dengan kode stabil; jangan melempar string bebas.
- Tidak ada catch kosong; tangani, ubah menjadi error domain, atau teruskan dengan konteks.
- Bedakan error klien (4xx) dari error server (5xx); 5xx dicatat lengkap di log, klien hanya menerima pesan umum dan requestId.
- Panggilan keluar (HTTP, database) punya timeout; retry hanya untuk error sementara dan operasi aman diulang.
- Log tidak pernah memuat token, kata sandi, header Authorization, atau isi .env.
- Bersihkan sumber daya (koneksi, timer, stream) di jalur gagal juga.
- Tulis tes untuk jalur gagal, bukan hanya jalur sukses.
