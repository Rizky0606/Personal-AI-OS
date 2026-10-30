# Rich Answers

## Tujuan

Jawaban agent dapat memuat komponen deklaratif aman melalui blok fenced `aios-ui`. Client memiliki kontrol penuh atas schema, layout, warna, interaksi, dan eksekusi. Agent tidak mengirim HTML, CSS, JavaScript, atau raw color.

## Format

```md
```aios-ui
{
  "version": 1,
  "components": [
    {
      "id": "revenue",
      "type": "metric",
      "label": "Pendapatan",
      "value": 42,
      "trend": { "value": 8, "direction": "up", "tone": "success" }
    }
  ]
}
```
```

Root object wajib memiliki `version` dan `components`. Semua object memakai schema strict. Unknown property, type, tone, URL, HTML, style, dan script ditolak.

## Komponen

Supported types:

- `metric`: angka, label, trend.
- `table`: kolom, baris.
- `chart`: chart `bar` atau `line` sederhana.
- `checklist`: item yang dapat dicentang.
- `choices`: pilihan satu atau banyak.
- `slider`: angka dalam rentang.
- `callout`: `info`, `success`, `warning`, `danger`.
- `steps`: langkah berurutan.
- `kv`: pasangan kunci-nilai.

Warna hanya semantic tone: `neutral`, `info`, `success`, `warning`, `danger`. Mapping tone ke token dilakukan client.

## Batas

- JSON maksimum 20 KiB.
- Maksimum 12 komponen per blok.
- Maksimum 24 titik chart.
- Maksimum 100 baris tabel.
- Maksimum 20 item choices, checklist, atau steps.
- Label maksimum 240 karakter.
- Teks panjang maksimum 4.000 karakter.
- Tidak ada child component recursion.

Parser memeriksa ukuran sebelum `JSON.parse`. JSON malformed, struktur invalid, unknown property, unsupported component, atau batas terlampaui ditampilkan sebagai blok kode biasa. Jawaban tidak boleh rusak atau menjadi kosong.

## Streaming dan history

Pagar `aios-ui` yang belum tertutup tidak diparse sebagai JSON parsial. Renderer menampilkan skeleton stabil sampai pagar tertutup. Setelah tertutup, schema divalidasi sekali.

Komponen interaktif hanya aktif pada jawaban assistant terakhir yang selesai. Jawaban lama bersifat read-only. Perubahan tidak menjadi efek samping lokal; client mengirim `followUp` sebagai pesan user baru.

```ts
{
  blockId: string;
  componentId: string;
  action: 'choice' | 'slider' | 'checklist';
  value: string | string[] | number | boolean;
}
```

## Security

Renderer memakai elemen React biasa dan jalur tautan aman yang sudah ada. Tidak ada `dangerouslySetInnerHTML`, iframe, evaluator, atau eksekusi isi agent. URL berbahaya (`javascript:`, `data:`) tidak menjadi link. Teks panjang dibatasi schema dan dibungkus CSS agar tidak merusak layout.

Chart memakai SVG native. Sumbu, label, `title`, `desc`, dan ringkasan `aria-label` wajib. Warna berasal dari token semantic.

Animasi masuk 240 ms. Bar/line chart menggambar selama 420 ms. `prefers-reduced-motion: reduce` mematikan animasi.

## Capability agent

Skill `rich-answers` mengajarkan kapan memakai komponen:

- perbandingan atau data → `table` atau `chart`;
- pilihan user → `choices`;
- prosedur berurutan → `steps`;
- angka penting → `metric`;
- jawaban pendek → teks biasa.

Rich answers aktif hanya pada engine yang terbukti mendukungnya. OMP dan dsh diuji; Hermes tetap memakai Markdown biasa sampai ada bukti.

## Android

Compose mendukung `metric`, `table`, `checklist`, `choices`, `callout`, dan `steps`. `chart`, `slider`, dan `kv` belum didukung. Invalid atau unsupported block selalu tampil sebagai fenced code, bukan empty state. Fixture contract bersama dipakai oleh desktop dan Android.

## Referensi pola

Cindy menunjukkan pola product-level: jawaban deklaratif dapat memuat chart dan interactive controls. Personal AI OS memakai subset strict, client-owned, tanpa rich HTML bebas, demi keamanan, parity, dan fallback deterministik.
