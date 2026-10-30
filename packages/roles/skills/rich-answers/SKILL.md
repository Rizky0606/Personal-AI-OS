---
name: rich-answers
description: Menyusun jawaban terstruktur memakai fenced aios-ui JSON yang aman dan tervalidasi.
---

# Rich answers

Gunakan hanya saat engine capability `rich_answers` aktif.

Format:

```aios-ui
{"version":1,"components":[{"id":"metric","type":"metric","label":"Label","value":42}]}
```

Aturan wajib:

- Hanya schema `@aios/contracts`.
- Maksimum 12 komponen; jangan kirim HTML, CSS, JavaScript, URL berbahaya, atau kode eksekusi.
- Tutup fenced block sebelum menganggap jawaban selesai.
- Pilih komponen sederhana: metric, table, chart, checklist, choices, slider, callout, steps, kv.
- Komponen interaktif harus menerima follow-up terstruktur; jangan mengklaim perubahan lokal sebelum agent memprosesnya.
- Jika data tidak cocok, gunakan Markdown biasa.
