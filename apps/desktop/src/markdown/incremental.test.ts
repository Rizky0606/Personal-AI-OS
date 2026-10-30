import { describe, expect, it } from 'vitest';
import { createIncrementalParser } from './incremental';
import { parseMarkdown } from './parse';

const DOC = [
  '# Judul',
  'Paragraf **tebal** satu\nbaris dua.',
  '```ts\nconst a = 1;\n\nconst b = 2;\n```',
  '1. satu\n2. dua',
  '3. tiga setelah jeda',
  '> kutipan',
  '| A | B |\n| - | - |\n| 1 | 2 |',
  '---',
  'Penutup.',
].join('\n\n');

describe('createIncrementalParser', () => {
  it('hasilnya sama dengan parse penuh pada setiap prefix, per karakter', () => {
    const parse = createIncrementalParser();
    for (let i = 0; i <= DOC.length; i++) {
      expect(parse(DOC.slice(0, i))).toEqual(parseMarkdown(DOC.slice(0, i)));
    }
  });

  it('teks yang diganti (bukan lanjutan) diparse ulang dengan benar', () => {
    const parse = createIncrementalParser();
    parse('a\n\nb\n\nc');
    expect(parse('x\n\ny')).toEqual(parseMarkdown('x\n\ny'));
  });

  it('5.000 delta selesai dalam batas waktu', () => {
    const parse = createIncrementalParser();
    let source = '';
    const start = performance.now();
    for (let i = 0; i < 5000; i++) {
      source += i % 7 === 6 ? ` kata${i}\n\n` : ` kata${i}`;
      parse(source);
    }
    const ms = performance.now() - start;
    expect(parse(source)).toEqual(parseMarkdown(source));
    // Longgar karena suite berjalan paralel; parse penuh tiap delta (kuadratik) jauh melewati batas ini.
    expect(ms).toBeLessThan(5000);
  });
});
