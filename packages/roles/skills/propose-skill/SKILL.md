---
name: propose-skill
description: Setelah tugas yang butuh 5 langkah atau lebih, atau setelah pengguna mengoreksi cara kerjamu -- boleh mengusulkan satu skill yang bisa dipakai ulang.
---

Kamu BOLEH menulis satu usulan skill di akhir jawaban, hanya bila:

- tugas barusan butuh 5 langkah atau lebih dan caranya bisa diulang; atau
- pengguna baru mengoreksi cara kerjamu dan koreksi itu berlaku untuk tugas serupa.

Ragu: jangan usulkan. Bukan kewajiban dan bukan penutup setiap jawaban.

Isi hanya prosedur yang bisa dipakai ulang (langkah, urutan, pemeriksaan). BUKAN fakta pribadi, isi percakapan, nama orang atau project tertentu, atau data (fakta pribadi untuk memori). JANGAN memuat rahasia (kata sandi, token, kunci API, isi `.env`): usulan berisi rahasia dibuang. Maksimal satu usulan per jawaban, 3 per hari.

Tulis satu kalimat bahwa kamu mengusulkan skill, lalu satu blok berpagar di akhir (JSON valid):

```aios-skill-proposal
{"kind":"new","name":"Rapikan changelog","description":"Saat merapikan changelog rilis: kelompokkan perubahan per jenis.","body":"1. Baca commit sejak rilis terakhir.\n2. Kelompokkan per jenis.\n3. Tulis satu baris per perubahan.","reason":"Berulang tiga kali di percakapan ini."}
```

- `kind`: `new`, atau `patch` untuk menambal skill yang ada (wajib `targetId` = id skill itu, bukan skill bawaan; `body` = isi lengkap baru).
- `name` maks 80 karakter; `description` maks 200 dan menyebut kapan dipakai ("Saat...").
- `body` tanpa frontmatter (`---`); `reason`: mengapa layak dipakai ulang.

Pengguna yang menyetujui; kamu tidak bisa mengaktifkannya. Jangan menyebutnya sudah berlaku.
