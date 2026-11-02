import { describe, expect, it } from 'vitest';
import { memoryTitle } from './service.js';

describe('memoryTitle (judul singkat fakta untuk context.used)', () => {
  it('fakta pendek utuh, huruf s dan titik tidak berubah', () => {
    expect(memoryTitle('Fakta uji untuk panel progres.')).toBe('Fakta uji untuk panel progres.');
  });

  it('spasi, tab, dan baris baru dipadatkan jadi satu spasi', () => {
    expect(memoryTitle('  Saya\tsuka\n\njawaban   singkat  ')).toBe('Saya suka jawaban singkat');
  });

  it('dipotong di 40 karakter dengan elipsis; tidak pernah memuat sisa isi', () => {
    const text = 'a'.repeat(40) + 'RAHASIA-di-ekor';
    const title = memoryTitle(text);
    expect(title).toBe(`${'a'.repeat(40)}…`);
    expect(title).not.toContain('RAHASIA');
  });

  it('tepat 40 karakter tidak diberi elipsis', () => {
    expect(memoryTitle('b'.repeat(40))).toBe('b'.repeat(40));
  });
});
