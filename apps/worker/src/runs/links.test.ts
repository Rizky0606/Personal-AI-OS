import { describe, expect, it } from 'vitest';
import { isLinkFromPrompt, urlsIn } from './links.js';

describe('tautan di prompt', () => {
  it('mengambil URL tanpa tanda baca penutup', () => {
    expect(urlsIn('lihat https://a.dev/x, lalu (https://b.dev/y).')).toEqual([
      'https://a.dev/x',
      'https://b.dev/y',
    ]);
  });

  it('mengizinkan hanya URL yang ditulis pemilik', () => {
    const prompt = 'analisa https://example.com/docs ya';
    expect(isLinkFromPrompt('https://example.com/docs', prompt)).toBe(true);
    expect(isLinkFromPrompt('URL: https://example.com/docs', prompt)).toBe(true);
    expect(isLinkFromPrompt('https://evil.test/?d=1', prompt)).toBe(false);
    expect(isLinkFromPrompt('https://example.com/docs https://evil.test', prompt)).toBe(false);
    expect(isLinkFromPrompt('cari harga gpu', prompt)).toBe(false);
  });
});
