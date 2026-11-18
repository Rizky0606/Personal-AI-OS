import { describe, expect, it } from 'vitest';
import { rememberFactFrom } from './memory-intent.js';

describe('rememberFactFrom', () => {
  it.each([
    [
      'Tolong ingat bahwa saya suka kopi tubruk tanpa gula, saya vegetarian, dan alergi kacang.',
      'Pemilik suka kopi tubruk tanpa gula, vegetarian, dan alergi kacang.',
    ],
    ['ingat ya, nama panggilan saya Oji', 'Nama panggilan pemilik Oji.'],
    ['Catat: aku tinggal di Bandung. Lalu buatkan resep.', 'Pemilik tinggal di Bandung.'],
    ['Simpan ke memori bahwa saya kerja shift malam ya', 'Pemilik kerja shift malam.'],
    [
      'Mohon diingat kalau saya lebih suka jawaban singkat, makasih!',
      'Pemilik lebih suka jawaban singkat.',
    ],
    ['Please remember that my daughter is Sari', 'My daughter is Sari.'],
  ])('%s', (input, fact) => {
    expect(rememberFactFrom(input)).toBe(fact);
  });

  it.each([
    'Ingat nggak kemarin kita bahas apa?',
    'Kamu ingat kopi favorit saya?',
    'Halo, apa kabar?',
    'Bagaimana cara mengingat rumus kimia?',
    'Tolong ingat ya',
    'Saya ingat bahwa dulu ada kereta uap.',
    '',
  ])('bukan permintaan mengingat: %s', (input) => {
    expect(rememberFactFrom(input)).toBeNull();
  });

  it('fakta dipotong ke batas memori', () => {
    const fact = rememberFactFrom(`Ingat bahwa ${'a'.repeat(900)}`);
    expect(fact?.length).toBeLessThanOrEqual(500);
    expect(fact?.endsWith('.')).toBe(true);
  });
});
