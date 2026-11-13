import { describe, expect, it } from 'vitest';
import {
  ARCHIVE_DAYS,
  MERGE_SIMILARITY,
  STALE_DAYS,
  classify,
  daysSince,
  similarity,
  tokens,
} from './curator.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-12T03:00:00.000Z');
const ago = (days: number, extraMs = 0) => new Date(NOW.getTime() - days * DAY - extraMs);

describe('kemiripan deskripsi (kata sederhana, tanpa model)', () => {
  it('kata sambung dan kata pendek diabaikan, huruf besar/aksen tidak berpengaruh', () => {
    expect([...tokens('Saat MERAPIKAN changelog, untuk rilis yang baru!')].sort()).toEqual([
      'baru',
      'changelog',
      'merapikan',
      'rilis',
    ]);
  });

  it('deskripsi sama = 1, tidak berbagi kata = 0, kosong = 0', () => {
    const a = 'Saat merapikan changelog rilis dan mengelompokkan perubahan.';
    expect(similarity(a, a)).toBe(1);
    expect(similarity(a, 'Saat menulis naskah video pendek dengan hook tiga detik.')).toBe(0);
    expect(similarity('', a)).toBe(0);
    expect(similarity('saat untuk yang', a)).toBe(0);
  });

  it('pasangan hampir sama melewati ambang saran gabung, topik berbeda tidak', () => {
    const a =
      'Saat merapikan changelog rilis: kelompokkan perubahan per jenis dan tulis satu baris.';
    const b =
      'Saat merapikan changelog rilis, kelompokkan perubahan per jenis lalu tulis satu baris.';
    const c = 'Saat meninjau diff pull request: urutkan temuan menurut tingkat keparahan.';
    expect(similarity(a, b)).toBeGreaterThanOrEqual(MERGE_SIMILARITY);
    expect(similarity(a, c)).toBeLessThan(MERGE_SIMILARITY);
  });

  it('simetris', () => {
    const a = 'periksa label fokus dan kontras antarmuka';
    const b = 'periksa kontras dan fokus pada layar';
    expect(similarity(a, b)).toBe(similarity(b, a));
  });
});

describe('aturan umur kurator dengan waktu palsu', () => {
  const base = { pinned: false, status: 'active' as const, now: NOW };

  it('angka dari spesifikasi dikunci: usang 30 hari, arsip 90 hari', () => {
    expect(STALE_DAYS).toBe(30);
    expect(ARCHIVE_DAYS).toBe(90);
  });

  it('daysSince menghitung hari penuh dan tidak pernah negatif', () => {
    expect(daysSince(ago(30), NOW)).toBe(30);
    expect(daysSince(ago(30, -1000), NOW)).toBe(29);
    expect(daysSince(new Date(NOW.getTime() + 5 * DAY), NOW)).toBe(0);
  });

  it('skill agent: <30 hari tidak disentuh, 30 hari usang, 89 hari tetap usang, 90 hari diarsipkan', () => {
    const at = (days: number) =>
      classify({ ...base, source: 'agent', lastActivity: ago(days) }).action;
    expect(at(0)).toBe('none');
    expect(at(STALE_DAYS - 1)).toBe('none');
    expect(at(STALE_DAYS)).toBe('stale');
    expect(at(ARCHIVE_DAYS - 1)).toBe('stale');
    expect(at(ARCHIVE_DAYS)).toBe('archive');
    expect(at(400)).toBe('archive');
  });

  it('skill buatan sendiri hanya diberi tanda, tidak pernah diarsipkan otomatis', () => {
    for (const days of [STALE_DAYS, ARCHIVE_DAYS, 1000]) {
      expect(classify({ ...base, source: 'user', lastActivity: ago(days) }).action).toBe('stale');
    }
    expect(classify({ ...base, source: 'user', lastActivity: ago(5) }).action).toBe('none');
  });

  it('skill yang disematkan tidak pernah disentuh, apa pun umurnya', () => {
    for (const source of ['agent', 'user', 'installed'] as const) {
      expect(classify({ ...base, pinned: true, source, lastActivity: ago(1000) }).action).toBe(
        'none',
      );
    }
  });

  it('skill nonaktif atau sudah diarsipkan dan skill terpasang dari luar tidak disentuh', () => {
    for (const status of ['disabled', 'archived'] as const) {
      expect(classify({ ...base, status, source: 'agent', lastActivity: ago(1000) }).action).toBe(
        'none',
      );
    }
    expect(classify({ ...base, source: 'installed', lastActivity: ago(1000) }).action).toBe('none');
  });
});
