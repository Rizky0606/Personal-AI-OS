import { describe, expect, it } from 'vitest';
import { CHUNK_CHARS, chunkText, keywordQuery } from './service.js';

describe('chunkText', () => {
  it('menggabung paragraf pendek sampai batas ukuran, dengan tumpang tindih di batas potongan', () => {
    const paragraph = (n: number) => `Paragraf ${n}. ${'isi '.repeat(60)}`.trim();
    const text = Array.from({ length: 10 }, (_, i) => paragraph(i + 1)).join('\n\n');
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= CHUNK_CHARS + 200)).toBe(true);
    expect(chunks[0]).toContain('Paragraf 1.');
    expect(chunks.join(' ')).toContain('Paragraf 10.');
  });

  it('paragraf sangat panjang tanpa baris kosong tetap dipecah; teks kosong tanpa potongan', () => {
    expect(chunkText('a'.repeat(5000)).length).toBeGreaterThanOrEqual(4);
    expect(chunkText('  \n\n ')).toEqual([]);
  });
});

describe('keywordQuery', () => {
  it('kata kunci tanpa kata umum, huruf kecil, tanpa aksen, dengan pencocokan awalan', () => {
    expect(keywordQuery('Apa isi pasal tentang DENDA keterlambatan di kontrak?')).toBe(
      'isi:* | pasal:* | tentang:* | denda:* | keterlambatan:* | kontrak:*',
    );
    expect(keywordQuery('Café crème')).toBe('cafe:* | creme:*');
  });

  it('tanda baca berbahaya untuk tsquery dibuang; pertanyaan tanpa kata kunci menghasilkan null', () => {
    expect(keywordQuery("x' | ! & (drop)")).toBe('drop:*');
    expect(keywordQuery('apa itu?')).toBeNull();
  });
});
