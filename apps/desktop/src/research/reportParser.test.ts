import { describe, expect, it } from 'vitest';
import { parseReport } from './reportParser';

const REPORT = `# Hasil

Bun lebih cepat [1] tetapi ekosistemnya lebih kecil [2].

## Daftar sumber

- [1] [Benchmark Bun](https://bun.sh/blog/x%28y%29) — bun.sh, diakses 22 Okt 2026
- [2] [Catatan Node](https://nodejs.org/en) — nodejs.org
- [3] [Berbahaya](javascript:alert(1)) — x
- bukan item
`;

describe('parseReport', () => {
  it('memisahkan isi dari daftar sumber dan memetakan nomor ke URL', () => {
    const report = parseReport(REPORT);

    expect(report.bodyMd).toBe(
      '# Hasil\n\nBun lebih cepat [1] tetapi ekosistemnya lebih kecil [2].',
    );
    expect(report.sources).toEqual([
      {
        n: 1,
        title: 'Benchmark Bun',
        url: 'https://bun.sh/blog/x(y)',
        meta: 'bun.sh, diakses 22 Okt 2026',
      },
      { n: 2, title: 'Catatan Node', url: 'https://nodejs.org/en', meta: 'nodejs.org' },
    ]);
    expect(report.citations.get(2)).toBe('https://nodejs.org/en');
    expect(report.citations.has(3)).toBe(false);
  });

  it('laporan tanpa daftar sumber dikembalikan utuh', () => {
    const report = parseReport('Hanya isi.\n');
    expect(report).toEqual({ bodyMd: 'Hanya isi.', sources: [], citations: new Map() });
  });
});
