import { describe, expect, it } from 'vitest';
import { withHistory } from './history.js';

describe('withHistory', () => {
  it('tanpa riwayat prompt tidak berubah', () => {
    expect(withHistory('halo', undefined)).toBe('halo');
    expect(withHistory('halo', [])).toBe('halo');
  });

  it('riwayat kronologis di depan, pesan terakhir di bawah', () => {
    const out = withHistory('lanjut', [
      { role: 'user', content: 'buat tombol' },
      { role: 'assistant', content: 'sudah' },
    ]);
    expect(out.indexOf('Pemilik: buat tombol')).toBeLessThan(out.indexOf('Kamu: sudah'));
    expect(out.endsWith('# Pesan terakhir pemilik\nlanjut')).toBe(true);
  });

  it('melebihi batas: giliran terbaru dipertahankan, yang lama dibuang', () => {
    const turns = Array.from({ length: 30 }, (_, i) => ({
      role: 'user' as const,
      content: `${i}:${'x'.repeat(3900)}`,
    }));
    const out = withHistory('p', turns);
    expect(out).toContain('29:');
    expect(out).not.toContain('Pemilik: 0:');
    expect(out.length).toBeLessThan(42_000);
  });
});
