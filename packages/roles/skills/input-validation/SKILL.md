---
name: input-validation
description: Saat menerima input dari luar (request, file, env) -- validasi dan bersihkan dulu sebelum dipakai, jangan percaya begitu saja.
---

- Anggap semua data dari luar tidak tepercaya: klien, webhook, file, env, keluaran model.
- Validasi bentuk, tipe, panjang, dan rentang dengan skema (Zod); tolak yang tidak sesuai, jangan memperbaikinya diam-diam.
- Query database selalu berparameter; tidak menyusun SQL, shell, atau path dari string pengguna.
- Path file dinormalisasi dan dipastikan tetap di dalam folder yang diizinkan.
- Batasi ukuran body, jumlah item, dan kedalaman; tolak lebih awal.
- Pesan error tidak memantulkan input mentah dan tidak membocorkan detail internal.
- Tulis tes untuk input kosong, terlalu panjang, tipe salah, dan karakter khusus.
