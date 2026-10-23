import { describe, expect, it } from 'vitest';
import {
  CronError,
  assertTimezone,
  describeCron,
  nextRuns,
  normalizeCron,
  occurrencesBetween,
  tzLabel,
} from './cron.js';

const JKT = 'Asia/Jakarta';

describe('validasi cron dan zona waktu', () => {
  it('menormalkan spasi dan menerima bentuk umum', () => {
    expect(normalizeCron('  */5   *  * * * ', JKT)).toBe('*/5 * * * *');
    for (const cron of [
      '0 7 * * 1',
      '0 8 * * 1-5',
      '30 6,18 * * *',
      '0 9 1,15 * *',
      '0 0 * * 0',
      '0 12 * * MON',
    ]) {
      expect(normalizeCron(cron, JKT)).toBe(cron);
    }
  });

  it.each([
    '',
    '* * * *',
    '* * * * * *',
    '61 * * * *',
    '* 25 * * *',
    '* * 32 * *',
    'setiap hari',
    '*/0 * * * *',
  ])('menolak "%s"', (cron) => {
    expect(() => normalizeCron(cron, JKT)).toThrowError(CronError);
    try {
      normalizeCron(cron, JKT);
    } catch (err) {
      expect((err as CronError).code).toBe('invalid_cron');
    }
  });

  it('zona waktu IANA saja', () => {
    expect(() => assertTimezone('Asia/Jakarta')).not.toThrow();
    expect(() => assertTimezone('UTC')).not.toThrow();
    for (const tz of ['WIB', 'Jakarta', 'Mars/Olympus', '']) {
      expect(() => assertTimezone(tz), tz).toThrowError(/Zona waktu/);
    }
    expect(() => normalizeCron('* * * * *', 'WIB')).toThrowError(CronError);
  });
});

describe('waktu jalan berikutnya', () => {
  it('"setiap 5 menit": kelipatan 5 menit, tiga kali berturut-turut', () => {
    const from = new Date('2026-10-22T06:02:30Z');
    expect(nextRuns('*/5 * * * *', JKT, from, 3).map((d) => d.toISOString())).toEqual([
      '2026-10-22T06:05:00.000Z',
      '2026-10-22T06:10:00.000Z',
      '2026-10-22T06:15:00.000Z',
    ]);
  });

  it('dihitung di zona waktu jadwal: Senin 07.00 WIB = Senin 00.00 UTC; 07.00 WITA = 23.00 UTC hari sebelumnya', () => {
    const from = new Date('2026-10-22T06:00:00Z'); // Kamis
    expect(nextRuns('0 7 * * 1', JKT, from, 2).map((d) => d.toISOString())).toEqual([
      '2026-10-26T00:00:00.000Z', // Senin 07.00 WIB = 00.00 UTC
      '2026-11-02T00:00:00.000Z',
    ]);
    expect(nextRuns('0 7 * * *', 'Asia/Makassar', from, 1)[0]?.toISOString()).toBe(
      '2026-10-22T23:00:00.000Z',
    );
  });

  it('kemunculan strictly sesudah waktu acuan, bukan sama dengan', () => {
    const exact = new Date('2026-10-22T06:05:00Z');
    expect(nextRuns('*/5 * * * *', JKT, exact, 1)[0]?.toISOString()).toBe(
      '2026-10-22T06:10:00.000Z',
    );
  });
});

describe('kemunculan yang terlewat', () => {
  it('menghitung semua di rentang (after, until] dan hanya menyimpan yang terbaru bila melebihi batas', () => {
    const after = new Date('2026-10-22T05:00:00Z');
    const until = new Date('2026-10-22T06:00:00Z');
    const all = occurrencesBetween('*/5 * * * *', JKT, after, until, 100);
    expect(all.total).toBe(12);
    expect(all.latest[0]?.toISOString()).toBe('2026-10-22T05:05:00.000Z');
    expect(all.latest.at(-1)?.toISOString()).toBe('2026-10-22T06:00:00.000Z');

    const capped = occurrencesBetween('*/5 * * * *', JKT, after, until, 3);
    expect(capped.total).toBe(12);
    expect(capped.latest.map((d) => d.toISOString())).toEqual([
      '2026-10-22T05:50:00.000Z',
      '2026-10-22T05:55:00.000Z',
      '2026-10-22T06:00:00.000Z',
    ]);
  });

  it('rentang kosong dan cron jarang menghasilkan nol', () => {
    const a = new Date('2026-10-22T06:00:00Z');
    expect(
      occurrencesBetween('0 7 * * 1', JKT, a, new Date(a.getTime() + 3600_000), 10).total,
    ).toBe(0);
    expect(occurrencesBetween('*/5 * * * *', JKT, a, a, 10).total).toBe(0);
  });
});

describe('penjelasan yang dibaca manusia', () => {
  it.each([
    ['* * * * *', JKT, 'Setiap menit'],
    ['*/5 * * * *', JKT, 'Setiap 5 menit'],
    ['*/15 * * * *', JKT, 'Setiap 15 menit'],
    ['0 * * * *', JKT, 'Setiap jam'],
    ['30 * * * *', JKT, 'Setiap jam pada menit ke-30'],
    ['0 */2 * * *', JKT, 'Setiap 2 jam'],
    ['30 6 * * *', JKT, 'Setiap hari 06.30 WIB'],
    ['0 7,19 * * *', JKT, 'Setiap hari 07.00 dan 19.00 WIB'],
    ['0 7 * * 1', JKT, 'Setiap Senin 07.00 WIB'],
    ['0 8 * * 1-5', JKT, 'Setiap Senin–Jumat 08.00 WIB'],
    ['0 20 * * 0', JKT, 'Setiap Minggu 20.00 WIB'],
    ['0 20 * * 7', JKT, 'Setiap Minggu 20.00 WIB'],
    ['0 9 * * 6,0', JKT, 'Setiap Sabtu dan Minggu 09.00 WIB'],
    ['0 9 * * 1,3,5', JKT, 'Setiap Senin, Rabu, dan Jumat 09.00 WIB'],
    ['0 9 1 * *', JKT, 'Setiap tanggal 1 pukul 09.00 WIB'],
    ['0 9 1,15 * *', JKT, 'Setiap tanggal 1 dan 15 pukul 09.00 WIB'],
    ['0 21 * * *', 'Asia/Makassar', 'Setiap hari 21.00 WITA'],
    ['0 6 * * *', 'Asia/Jayapura', 'Setiap hari 06.00 WIT'],
    ['0 6 * * *', 'UTC', 'Setiap hari 06.00 UTC'],
    ['0 6 * * *', 'Europe/Paris', 'Setiap hari 06.00 Europe/Paris'],
  ])('%s (%s) → %s', (cron, tz, expected) => {
    expect(describeCron(cron, tz)).toBe(expected);
  });

  it('bentuk yang tidak dikenali jatuh ke cron apa adanya, bukan tebakan', () => {
    expect(describeCron('0 8-18/2 * * *', JKT)).toBe('Cron "0 8-18/2 * * *" (WIB)');
    expect(describeCron('0 9 * 3 *', JKT)).toBe('Cron "0 9 * 3 *" (WIB)');
    expect(describeCron('0 9 15 * 1', JKT)).toBe('Cron "0 9 15 * 1" (WIB)');
    expect(describeCron('0,30 9 * * *', JKT)).toBe('Cron "0,30 9 * * *" (WIB)');
  });

  it('label zona', () => {
    expect([
      tzLabel('Asia/Jakarta'),
      tzLabel('Asia/Makassar'),
      tzLabel('Asia/Jayapura'),
      tzLabel('UTC'),
    ]).toEqual(['WIB', 'WITA', 'WIT', 'UTC']);
  });
});
