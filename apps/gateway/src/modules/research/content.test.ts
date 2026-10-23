import { describe, expect, it } from 'vitest';
import { MIN_TEXT_CHARS, extractReadable, needsJavaScript } from './extract.js';
import { parseBlocks, parseInline } from './markdown.js';
import { renderReportPdf } from './pdf.js';
import {
  UNCITED_MARK,
  buildSourceSection,
  checkCitations,
  markUncited,
  normalizeRefs,
  renumberCitations,
  reportSlug,
  splitUnits,
  stripInvalidRefs,
} from './report.js';
import {
  LOW_QUALITY_DOMAINS,
  domainOf,
  isLowQualityDomain,
  normalizeUrl,
  selectCandidates,
} from './select.js';
import type { SearchResult } from './search.js';

const para = (n: number) =>
  `Paragraf ${n} membahas pasar mobil listrik di Asia Tenggara dengan angka penjualan, regulasi insentif, dan perbandingan antarnegara secara rinci.`;

const ARTICLE = `<!doctype html><html lang="id"><head>
<title>Laporan Mobil Listrik 2026 | Situs Berita</title>
<meta property="article:published_time" content="2026-09-30T08:00:00Z">
<script>window.tracker = 'JANGAN-MASUK'</script><style>.x{color:red}</style></head>
<body><nav><a href="/">Beranda</a> <a href="/politik">Politik</a> MENU-NAVIGASI</nav>
<article><h1>Laporan Mobil Listrik 2026</h1>
${[1, 2, 3, 4, 5].map((n) => `<p>${para(n)}</p>`).join('\n')}
</article>
<aside>IKLAN-SAMPING berlangganan newsletter sekarang juga</aside>
<footer>Hak cipta FOOTER-SITUS</footer></body></html>`;

describe('ekstraksi Readability', () => {
  it('mengambil isi artikel, membuang navigasi/iklan/skrip, dan membaca tanggal terbit', () => {
    const page = extractReadable(ARTICLE, 'https://contoh.id/berita/mobil-listrik');
    expect(page.title).toContain('Laporan Mobil Listrik 2026');
    expect(page.text).toContain('Paragraf 3 membahas pasar mobil listrik');
    expect(page.text.length).toBeGreaterThan(MIN_TEXT_CHARS);
    for (const noise of [
      'JANGAN-MASUK',
      'MENU-NAVIGASI',
      'IKLAN-SAMPING',
      'FOOTER-SITUS',
      'color:red',
    ]) {
      expect(page.text, noise).not.toContain(noise);
    }
    expect(page.publishedAt).toBe('2026-09-30T08:00:00Z');
    expect(page.text).not.toMatch(/\n{3,}/);
  });

  it('halaman tanpa artikel: jatuh ke teks body, judul dari <title>, dan tidak melempar', () => {
    const page = extractReadable(
      '<html><head><title>Judul Saja</title></head><body>Halo</body></html>',
      'https://contoh.id/',
    );
    expect(page.title).toBe('Judul Saja');
    expect(page.text).toContain('Halo');
  });

  it('tidak menjalankan skrip dan tidak memuat sumber daya luar', () => {
    const page = extractReadable(
      `<html><body><div id="x">kosong</div><script>document.getElementById('x').textContent='DIJALANKAN'</script>
      <img src="http://127.0.0.1:1/pelacak.png"><p>${para(1)} ${para(2)} ${para(3)}</p></body></html>`,
      'https://contoh.id/',
    );
    expect(page.text).not.toContain('DIJALANKAN');
  });

  it('memotong teks sangat panjang', () => {
    const page = extractReadable(
      `<article><p>${'kata '.repeat(10_000)}</p></article>`,
      'https://contoh.id/',
    );
    expect(page.text.length).toBeLessThanOrEqual(12_000);
  });
});

describe('deteksi halaman yang butuh JavaScript', () => {
  it('shell SPA (div#root + skrip, teks nyaris kosong) butuh render; artikel panjang dan halaman kecil tanpa skrip tidak', () => {
    const spa =
      '<html><body><div id="root"></div><script src="/app.js"></script><script>boot()</script></body></html>';
    expect(needsJavaScript(spa, 0)).toBe(true);
    expect(needsJavaScript('<body><div id="__next"></div></body>', 10)).toBe(true);
    expect(needsJavaScript(spa, MIN_TEXT_CHARS + 1)).toBe(false);
    expect(needsJavaScript('<html><body>Halaman pendek</body></html>', 14)).toBe(false);
  });
});

const result = (url: string, title = url): SearchResult => ({
  url,
  title,
  snippet: '',
  engine: null,
  publishedDate: null,
});

describe('pemilihan sumber', () => {
  it('normalizeUrl: sama untuk www, skema, fragmen, parameter pelacak, urutan query, dan garis miring akhir', () => {
    const key = normalizeUrl('https://contoh.com/artikel?b=2&a=1');
    for (const variant of [
      'http://www.contoh.com/artikel/?a=1&b=2',
      'https://CONTOH.com/artikel?a=1&b=2&utm_source=x&fbclid=abc#bagian',
    ]) {
      expect(normalizeUrl(variant), variant).toBe(key);
    }
    expect(normalizeUrl('https://contoh.com/artikel?a=2&b=2')).not.toBe(key);
    expect(normalizeUrl('https://contoh.com/lain?a=1&b=2')).not.toBe(key);
  });

  it('domain berkualitas rendah dikenali termasuk subdomain, tanpa salah sasaran', () => {
    expect(LOW_QUALITY_DOMAINS.length).toBeGreaterThan(10);
    for (const url of [
      'https://www.facebook.com/x',
      'https://m.youtube.com/watch?v=1',
      'https://youtu.be/abc',
      'https://id.pinterest.com/pin/1',
      'https://x.com/user/status/1',
    ]) {
      expect(isLowQualityDomain(url), url).toBe(true);
    }
    for (const url of ['https://notfacebook.com/', 'https://kompas.com/x', 'https://max.com/']) {
      expect(isLowQualityDomain(url), url).toBe(false);
    }
    expect(domainOf('https://www.Contoh.com/a')).toBe('contoh.com');
  });

  it('membuang duplikat, domain buruk, berkas non-HTML, dan skema aneh; mengambil bergiliran antar kueri', () => {
    const q1 = [
      result('https://a.com/1'),
      result('https://www.a.com/1/?utm_source=x'),
      result('https://youtube.com/watch?v=1'),
      result('https://b.com/laporan.pdf'),
      result('ftp://c.com/x'),
      result('bukan url'),
      result('https://b.com/2'),
    ];
    const q2 = [result('https://d.com/1'), result('https://a.com/1'), result('https://e.com/1')];
    const picked = selectCandidates([q1, q2], { pool: 10, perDomain: 5 });
    expect(picked.map((c) => c.url)).toEqual([
      'https://a.com/1',
      'https://d.com/1',
      'https://e.com/1',
      'https://b.com/2',
    ]);
    expect(picked.map((c) => [c.queryIndex, c.rank])).toEqual([
      [0, 0],
      [1, 0],
      [1, 2],
      [0, 6],
    ]);
  });

  it('membatasi jumlah per domain dan ukuran pool', () => {
    const many = Array.from({ length: 10 }, (_, i) => result(`https://sama.com/${i}`));
    expect(selectCandidates([many], { pool: 10, perDomain: 2 })).toHaveLength(2);
    const different = Array.from({ length: 10 }, (_, i) => result(`https://situs${i}.com/`));
    expect(selectCandidates([different], { pool: 4, perDomain: 2 })).toHaveLength(4);
    expect(selectCandidates([], { pool: 4, perDomain: 2 })).toEqual([]);
  });
});

const factual = (suffix: string) =>
  `Penjualan mobil listrik naik tajam di Indonesia sepanjang tahun lalu${suffix}`;

describe('pemeriksaan rujukan', () => {
  it('normalizeRefs: [1, 2] dan [1;2] menjadi [1][2]', () => {
    expect(normalizeRefs('Fakta [1, 2] dan [3;4;5] serta [6].')).toBe(
      'Fakta [1][2] dan [3][4][5] serta [6].',
    );
  });

  it('splitUnits: judul dilewati, butir daftar berdiri sendiri, baris lanjutan digabung, blok kode diabaikan', () => {
    const units = splitUnits(
      [
        '# Judul',
        '',
        'Satu kalimat',
        'lanjutan baris.',
        '',
        '- butir satu [1]',
        '- butir dua [2]',
        '```',
        'kode [9]',
        '```',
      ].join('\n'),
    );
    expect(units.map((u) => u.text)).toEqual([
      'Satu kalimat lanjutan baris.',
      'butir satu [1]',
      'butir dua [2]',
    ]);
  });

  it('paragraf faktual tanpa rujukan dan rujukan di luar rentang terdeteksi', () => {
    const md = [
      '# Laporan',
      '## Ringkasan',
      `${factual(' [1].')}`,
      factual('.'),
      `${factual(' [7].')}`,
      'Pendek saja.',
    ].join('\n\n');
    const check = checkCitations(md, 3);
    expect(check.invalid).toEqual([7]);
    expect(check.uncited).toHaveLength(2); // yang tanpa rujukan dan yang rujukannya tidak sah
    expect(check.uncited[0]).toContain('Penjualan mobil listrik');
  });

  it('bagian "Batasan", judul, dan baris meta bergaris miring tidak dituntut rujukan; butir daftar dituntut', () => {
    const md = [
      '# Laporan',
      '_Dibuat otomatis 2026-10-22 · kedalaman standar · 3 sumber_',
      '## Batasan dan ketidakpastian',
      'Sumber yang tersedia terbatas pada media berbahasa Indonesia dan Inggris saja.',
      '## 1. Pasar',
      `- ${factual(' [1]')}`,
      `- ${factual('')}`,
    ].join('\n\n');
    expect(checkCitations(md.replace('\n\n- ', '\n- '), 2).uncited).toHaveLength(1);
  });

  it('stripInvalidRefs membuang hanya nomor yang tidak sah', () => {
    expect(stripInvalidRefs('A [1][9] B [0] C [2, 5].', 3)).toBe('A [1] B  C [2].');
  });

  it('markUncited menandai terbuka dan menghitungnya', () => {
    const md = `# J\n\n${factual(' [1].')}\n\n${factual('.')}`;
    const marked = markUncited(md, 2);
    expect(marked.count).toBe(1);
    expect(marked.md).toContain(`${factual('.')}${UNCITED_MARK}`);
    expect(marked.md).toContain(`${factual(' [1].')}\n`);
  });

  it('renumberCitations: nomor baru menurut kemunculan pertama, konsisten di seluruh teks', () => {
    const { md, order } = renumberCitations('Awal [5][2]. Tengah [2][7]. Akhir [5].');
    expect(md).toBe('Awal [1][2]. Tengah [2][3]. Akhir [1].');
    expect(order).toEqual([5, 2, 7]);
    expect(renumberCitations('Tanpa rujukan.')).toEqual({ md: 'Tanpa rujukan.', order: [] });
  });

  it('daftar sumber: judul bertautan ke URL, domain, tanggal akses; kurung di judul dan URL diamankan', () => {
    const section = buildSourceSection([
      {
        title: 'Mobil [Listrik] 2026',
        url: 'https://www.kompas.com/a(b)',
        accessedAt: new Date('2026-10-22T10:00:00Z'),
      },
      { title: '', url: 'https://contoh.org/x y', accessedAt: new Date('2026-10-22T23:59:00Z') },
    ]);
    expect(section).toBe(
      '## Daftar sumber\n\n' +
        '- [1] [Mobil (Listrik) 2026](https://www.kompas.com/a%28b%29) — kompas.com, diakses 2026-10-22\n' +
        '- [2] [contoh.org](https://contoh.org/x%20y) — contoh.org, diakses 2026-10-22\n',
    );
  });

  it('reportSlug: huruf kecil tanpa aksen, maksimal 6 kata, cadangan "riset"', () => {
    expect(
      reportSlug('Apa dampak Kebijakan Pajak Karbon terhadap UMKM di Indonesia pada 2026?'),
    ).toBe('apa-dampak-kebijakan-pajak-karbon-terhadap');
    expect(reportSlug('Café déjà vu')).toBe('cafe-deja-vu');
    expect(reportSlug('???')).toBe('riset');
  });
});

describe('Markdown dan PDF', () => {
  it('parseInline: tautan, tebal, miring, kode; teks polos tetap utuh', () => {
    expect(parseInline('a **b** _c_ [d](https://x.id) `e` f')).toEqual([
      { text: 'a ' },
      { text: 'b', bold: true },
      { text: ' ' },
      { text: 'c', italic: true },
      { text: ' ' },
      { text: 'd', link: 'https://x.id' },
      { text: ' ' },
      { text: 'e' },
      { text: ' f' },
    ]);
    expect(parseInline('snake_case_name dan 2*3*4')).toEqual([
      { text: 'snake_case_name dan 2*3*4' },
    ]);
  });

  it('parseBlocks: judul, paragraf (baris digabung), daftar bullet dan bernomor', () => {
    const blocks = parseBlocks('# Judul\n\nSatu\ndua.\n\n- a\n- b\n\n1. x\n2. y\n\n#### Dalam');
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'list', 'list', 'heading']);
    expect(blocks[1]).toEqual({ type: 'paragraph', inlines: [{ text: 'Satu dua.' }] });
    expect(blocks[2]).toMatchObject({ ordered: false });
    expect(blocks[3]).toMatchObject({ ordered: true });
    expect(blocks[4]).toMatchObject({ level: 3 });
  });

  it('renderReportPdf: PDF sah, beberapa halaman untuk laporan panjang, karakter di luar WinAnsi tidak merusak', async () => {
    const md = [
      '# Laporan: mobil listrik',
      '_Dibuat otomatis_',
      '## Ringkasan',
      ...Array.from(
        { length: 60 },
        (_, i) =>
          `${para(i)} [${(i % 3) + 1}] **Penting** dan _miring_ 日本語 😀 “kutip” — selesai.`,
      ),
      '## Daftar sumber',
      '- [1] [Kompas](https://www.kompas.com/a) — kompas.com, diakses 2026-10-22',
    ].join('\n\n');
    const pdf = await renderReportPdf(md, { title: 'Mobil listrik: 日本語' });
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.subarray(-16).toString('latin1')).toContain('%%EOF');
    const pages = (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
    expect(pages).toBeGreaterThanOrEqual(3);
    expect(pdf.length).toBeGreaterThan(5000);
    // Tautan sumber menjadi anotasi yang bisa diklik.
    expect(pdf.toString('latin1')).toContain('https://www.kompas.com/a');
  });

  it('laporan kosong tetap menghasilkan PDF sah', async () => {
    const pdf = await renderReportPdf('', { title: 'Kosong' });
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});
