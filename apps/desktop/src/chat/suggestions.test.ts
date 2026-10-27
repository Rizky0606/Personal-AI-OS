import { describe, expect, it } from 'vitest';
import { splitSuggestions } from './suggestions';

describe('splitSuggestions', () => {
  it('tanpa blok: teks apa adanya', () => {
    expect(splitSuggestions('Halo')).toEqual({ body: 'Halo', suggestions: [] });
  });

  it('memisahkan blok saran dari jawaban dan membersihkan penanda daftar', () => {
    const out = splitSuggestions(
      'Fitur yang bisa ditambah: A dan B.\n\n[saran]\n- Tambahkan A\n* Buat tes untuk B\n1. Jelaskan struktur folder\n[/saran]',
    );
    expect(out.body).toBe('Fitur yang bisa ditambah: A dan B.');
    expect(out.suggestions).toEqual([
      'Tambahkan A',
      'Buat tes untuk B',
      'Jelaskan struktur folder',
    ]);
  });

  it('blok yang belum tertutup disembunyikan tanpa saran; maksimal 3, duplikat dan baris terlalu panjang dibuang', () => {
    expect(splitSuggestions('Jawaban\n[saran]\n- Tamb')).toEqual({
      body: 'Jawaban',
      suggestions: [],
    });
    const long = 'x'.repeat(200);
    const out = splitSuggestions(
      `J\n[saran]\n- satu\n- satu\n- ${long}\n- dua\n- tiga\n- empat\n[/saran]`,
    );
    expect(out.suggestions).toEqual(['satu', 'dua', 'tiga']);
  });
});
