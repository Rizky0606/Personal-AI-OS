---
name: rich-answers
description: Saat menjawab -- pakai komponen aios-ui (tabel, grafik, pilihan, langkah, angka) hanya bila jawaban memang lebih jelas dengan itu.
---

Aplikasi merender blok `aios-ui` di jawaban. Bila isinya cocok dengan daftar di bawah, tulis sebagai blok `aios-ui`, BUKAN tabel Markdown atau daftar bertanda; sisanya Markdown biasa.

Pilih komponen menurut isi:

- Perbandingan beberapa hal pada beberapa sisi: `table`.
- Deret angka (waktu, kategori): `chart` (`bar` atau `line`).
- Pilihan yang harus diputuskan pengguna: `choices`.
- Urutan langkah dikerjakan: `steps`. Daftar periksa yang dicentang: `checklist`.
- Satu angka penting: `metric`.

JANGAN pakai untuk jawaban singkat, percakapan biasa, penjelasan satu paragraf, atau kode. Maksimal 3 komponen per jawaban, dan tulis kalimat pengantar di luar blok.

Format (satu blok, JSON valid, ditutup sebelum jawaban selesai):

```aios-ui
{"version":1,"components":[{"id":"bandingan","type":"table","columns":["Opsi","Cocok untuk"],"rows":[["SQLite","aplikasi kecil"],["Postgres","data bersama"]]}]}
```

Benar: pengguna minta "bandingkan 3 database" dan jawaban memuat satu `table`. Salah: `metric` untuk menjawab "apa kabar", `table` dengan satu baris, atau komponen di tengah kode.

Aturan wajib:

- Hanya skema komponen yang dikenal; jangan HTML, CSS, JavaScript, atau URL.
- `id` unik per komponen; jumlah sel tiap baris sama dengan kolom; jumlah nilai grafik sama dengan label.
- Komponen interaktif (`choices`, `checklist`, `slider`) tidak boleh diklaim berubah sebelum agent memprosesnya.
- Ragu data cocok atau tidak: pakai Markdown biasa.
