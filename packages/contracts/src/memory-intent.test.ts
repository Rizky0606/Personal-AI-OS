import { describe, expect, it } from 'vitest';
import { rememberFactFrom, scheduleRequestFrom } from './memory-intent.js';

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
    [
      'Usulkan juga untuk menyimpan ke memori bahwa saya alergi udang. Ajukan sebagai usulan yang bisa saya setujui di aplikasi.',
      'Pemilik alergi udang.',
    ],
    ['Tolong usulkan memori: saya suka teh melati.', 'Pemilik suka teh melati.'],
    ['Propose a memory that my cat is Mochi', 'My cat is Mochi.'],
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

  it('permintaan jadwal ("ingatkan saya setiap…") bukan fakta untuk diingat', () => {
    expect(rememberFactFrom('Ingatkan saya setiap Jumat jam 16.00 untuk kirim laporan')).toBeNull();
  });
});

describe('scheduleRequestFrom', () => {
  it.each([
    [
      'Jadwalkan pengingat setiap Jumat jam 16.00 untuk kirim laporan mingguan.',
      'Jadwalkan pengingat setiap Jumat jam 16.00 untuk kirim laporan mingguan.',
    ],
    [
      'Usulkan jadwal setiap Senin jam 08.00 untuk ringkasan berita. Ajukan sebagai usulan yang bisa saya setujui di aplikasi.',
      'Usulkan jadwal setiap Senin jam 08.00 untuk ringkasan berita.',
    ],
    [
      'Tolong usulkan juga sebuah jadwal harian untuk cek kurs, ya',
      'Tolong usulkan juga sebuah jadwal harian untuk cek kurs.',
    ],
    ['Buatkan pengingat besok pagi minum obat', 'Buatkan pengingat besok pagi minum obat.'],
    [
      'Ingatkan saya tiap malam untuk mematikan kompor',
      'Ingatkan saya tiap malam untuk mematikan kompor.',
    ],
    ['Bisa jadwalkan rapat mingguan tiap Rabu?', 'Bisa jadwalkan rapat mingguan tiap Rabu.'],
    ['Propose a schedule for a daily news digest', 'Propose a schedule for a daily news digest.'],
  ])('%s', (input, request) => {
    expect(scheduleRequestFrom(input)).toBe(request);
  });

  it.each([
    'Jadwal saya besok apa saja?',
    'Schedule saya besok apa?',
    'Bagaimana cara menjadwalkan cron di Linux?',
    'Tolong ingat bahwa saya suka kopi',
    'Ingatkan saya bahwa kode loker 4412',
    'Halo',
    '',
  ])('bukan permintaan jadwal: %s', (input) => {
    expect(scheduleRequestFrom(input)).toBeNull();
  });

  it('permintaan dipotong ke batas event', () => {
    const request = scheduleRequestFrom(`Jadwalkan ${'a'.repeat(900)}`);
    expect(request?.length).toBeLessThanOrEqual(500);
  });
});
