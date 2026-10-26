import { describe, expect, it } from 'vitest';
import { fillTemplate, slashMatches, templateParams } from './vars';

describe('parameter templat', () => {
  it('mengambil nama unik berurutan, dengan spasi di dalam kurung diizinkan', () => {
    expect(templateParams('Ringkas {{topik}} untuk {{ audiens }}, lalu {{topik}} lagi')).toEqual([
      'topik',
      'audiens',
    ]);
    expect(templateParams('Tanpa parameter {bukan} {{}} {{a b}}')).toEqual([]);
  });

  it('mengisi semua kemunculan; yang tanpa nilai menjadi kosong; $ tidak ditafsirkan', () => {
    expect(fillTemplate('{{a}} dan {{b}} dan {{a}}', { a: 'X' })).toBe('X dan  dan X');
    expect(fillTemplate('Harga {{h}}', { h: '$& $1' })).toBe('Harga $& $1');
  });
});

describe('slashMatches', () => {
  const t = (name: string) => ({ name });
  const all = [t('ringkas-berita'), t('review-pr'), t('terjemah'), t('berita-pagi')];

  it('hanya untuk draf berupa /awalan tanpa spasi', () => {
    expect(slashMatches('halo', all)).toEqual([]);
    expect(slashMatches('/ringkas berita', all)).toEqual([]);
    expect(slashMatches('/Ringkas', all)).toEqual([]);
  });

  it('awalan lebih dulu, lalu yang mengandung; "/" saja menampilkan semua (maks 6)', () => {
    expect(slashMatches('/r', all).map((x) => x.name)).toEqual([
      'ringkas-berita',
      'review-pr',
      'terjemah',
      'berita-pagi',
    ]);
    expect(slashMatches('/berita', all).map((x) => x.name)).toEqual([
      'berita-pagi',
      'ringkas-berita',
    ]);
    expect(slashMatches('/', all)).toHaveLength(4);
    expect(
      slashMatches(
        '/',
        Array.from({ length: 9 }, (_, i) => t(`t${i}`)),
      ),
    ).toHaveLength(6);
    expect(slashMatches('/zzz', all)).toEqual([]);
  });
});
