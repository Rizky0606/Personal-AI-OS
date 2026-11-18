import { describe, expect, it } from 'vitest';
import { timeSection } from './runner.js';

describe('timeSection', () => {
  it('tanggal, hari, dan jam di zona pemilik (bawaan Asia/Jakarta)', () => {
    // 2026-11-17 16.04 UTC = Selasa 23.04 WIB; 17.30 UTC sudah Rabu di Jakarta.
    expect(timeSection(Date.UTC(2026, 10, 17, 16, 4))).toBe(
      '# Waktu\nSekarang Selasa, 17 November 2026 pukul 23.04 WIB. Pakai ini untuk "hari ini", "minggu ini", dan tanggal relatif.',
    );
    expect(timeSection(Date.UTC(2026, 10, 17, 17, 30))).toContain('Rabu, 18 November 2026');
    expect(timeSection(Date.UTC(2026, 10, 17, 17, 30), 'UTC')).toContain(
      'Selasa, 17 November 2026 pukul 17.30 UTC',
    );
  });
});
