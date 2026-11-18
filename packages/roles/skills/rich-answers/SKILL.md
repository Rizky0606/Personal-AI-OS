---
name: rich-answers
description: Saat menjawab -- pakai komponen aios-ui (tabel, grafik, pilihan, langkah, angka) hanya bila jawaban memang lebih jelas dengan itu.
---

Aplikasi merender blok `aios-ui`. JANGAN pakai untuk jawaban singkat, percakapan biasa, satu paragraf, atau kode. Maksimal 3 komponen, kalimat pengantar di luar blok.

Satu blok, JSON valid, ditutup sebelum jawaban selesai:

```aios-ui
{"version":1,"components":[{"id":"bandingan","type":"table","columns":["Opsi","Cocok untuk"],"rows":[["SQLite","aplikasi kecil"],["Postgres","data bersama"]]}]}
```

Isi `components` per jenis; tulis field PERSIS seperti ini (field lain ditolak):

- Perbandingan: `{"id":"t","type":"table","columns":["A","B"],"rows":[["1","2"]]}`
- Deret angka: `{"id":"g","type":"chart","chart":"bar","label":"Skor","labels":["X","Y"],"values":[9,7]}` (`chart` = `bar` atau `line`; bukan `chartType`, tanpa `max`/`title`)
- Satu angka penting: `{"id":"m","type":"metric","label":"Total","value":199800,"unit":"Rp"}`
- Pilihan untuk pengguna: `{"id":"c","type":"choices","mode":"single","options":[{"id":"a","label":"Opsi A"}]}`
- Urutan langkah: `{"id":"s","type":"steps","items":[{"id":"1","title":"Pasang","text":"npm i"}]}`
- Daftar periksa: `{"id":"k","type":"checklist","items":[{"id":"1","label":"Paspor","checked":false}]}`

Benar: "bandingkan 3 database" dijawab satu `table`. Salah: `metric` untuk "apa kabar", `table` satu baris.

Aturan wajib:

- Sel tiap baris = jumlah kolom; nilai grafik berupa angka, sebanyak label.
- Tanpa HTML, CSS, JavaScript, atau URL.
- Komponen interaktif tidak boleh diklaim berubah sebelum agent memprosesnya.
- Ragu: pakai Markdown biasa.
