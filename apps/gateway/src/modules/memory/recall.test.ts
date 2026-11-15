import { describe, expect, it } from 'vitest';
import { selectMemories, type RecallCandidate } from './recall.js';

/** Satu fakta = baris `- <teks>` + pemisah baris, jadi biayanya panjang teks + 3. */
const COST_OVERHEAD = 3;
const T0 = Date.UTC(2026, 0, 1);

/** Memori ke-n: dibuat pada menit ke-n; `updated` (menit) menentukan urutan "terbaru". */
const fact = (
  n: number,
  chars: number,
  extra: { pinned?: boolean; updated?: number } = {},
): RecallCandidate => ({
  id: `m${String(n).padStart(2, '0')}`,
  text: `${n}`.padEnd(chars - COST_OVERHEAD, 'x'),
  pinned: extra.pinned ?? false,
  createdAt: new Date(T0 + n * 60_000),
  updatedAt: new Date(T0 + (extra.updated ?? n) * 60_000),
});

const ids = (picks: { id: string }[]) => picks.map((p) => p.id);
const cost = (picks: { text: string }[]) =>
  picks.reduce((sum, p) => sum + p.text.length + COST_OVERHEAD, 0);

describe('selectMemories: batas anggaran', () => {
  const active = [fact(1, 100), fact(2, 100, { pinned: true }), fact(3, 100)];

  it('total tepat sama dengan anggaran: semua ikut, terlama dulu, hanya yang tersemat diberi alasan', () => {
    const out = selectMemories({ active, lexical: ['m03'], budgetChars: 300, topK: 12 });
    expect(out.mode).toBe('all');
    expect(out.picks).toEqual([
      { id: 'm01', text: active[0]!.text },
      { id: 'm02', text: active[1]!.text, via: 'pinned' },
      { id: 'm03', text: active[2]!.text },
    ]);
    expect(out.pinnedDropped).toBe(0);
  });

  it('satu karakter di atas anggaran: beralih ke pemilihan dan tidak pernah melewati anggaran', () => {
    const out = selectMemories({ active, lexical: ['m03'], budgetChars: 299, topK: 12 });
    expect(out.mode).toBe('lexical');
    expect(out.picks.map((p) => [p.id, p.via])).toEqual([
      ['m02', 'pinned'],
      ['m03', 'lexical'],
    ]);
    expect(cost(out.picks)).toBeLessThanOrEqual(299);
  });

  it('tanpa memori aktif: mode all tanpa butir', () => {
    expect(selectMemories({ active: [], lexical: [], budgetChars: 100, topK: 12 })).toEqual({
      mode: 'all',
      picks: [],
      pinnedDropped: 0,
    });
  });
});

describe('selectMemories: di atas anggaran', () => {
  it('urutan prioritas: tersemat, cocok kata (urutan peringkat), lalu yang paling baru diubah', () => {
    const active = [
      fact(1, 100, { pinned: true }),
      fact(2, 100),
      fact(3, 100, { updated: 90 }),
      fact(4, 100),
      fact(5, 100, { updated: 80 }),
      fact(6, 100),
      fact(7, 100),
    ];
    const out = selectMemories({
      active,
      lexical: ['m06', 'm02'],
      budgetChars: 500,
      topK: 12,
    });
    expect(out.picks.map((p) => [p.id, p.via])).toEqual([
      ['m01', 'pinned'],
      ['m06', 'lexical'],
      ['m02', 'lexical'],
      ['m03', 'recent'],
      ['m05', 'recent'],
    ]);
    expect(cost(out.picks)).toBe(500);
  });

  it('topK membatasi yang masuk karena cocok kata; sisanya hanya bisa masuk sebagai terbaru', () => {
    const active = Array.from({ length: 8 }, (_, i) => fact(i + 1, 100));
    const out = selectMemories({
      active,
      lexical: ['m01', 'm02', 'm03'],
      budgetChars: 400,
      topK: 2,
    });
    expect(out.picks.map((p) => [p.id, p.via])).toEqual([
      ['m01', 'lexical'],
      ['m02', 'lexical'],
      ['m08', 'recent'],
      ['m07', 'recent'],
    ]);
  });

  it('fakta yang tidak muat dilewati dan yang lebih pendek sesudahnya tetap dicoba', () => {
    const active = [fact(1, 250), fact(2, 250), fact(3, 40), fact(4, 250)];
    const out = selectMemories({
      active,
      lexical: ['m01', 'm02', 'm03'],
      budgetChars: 300,
      topK: 12,
    });
    expect(ids(out.picks)).toEqual(['m01', 'm03']);
    expect(cost(out.picks)).toBeLessThanOrEqual(300);
  });

  it('id cocok kata yang tersemat, ganda, atau bukan memori aktif tidak menggandakan atau menambah butir', () => {
    const active = [fact(1, 100, { pinned: true }), fact(2, 100), fact(3, 100), fact(4, 100)];
    const out = selectMemories({
      active,
      lexical: ['m01', 'hilang', 'm02', 'm02'],
      budgetChars: 200,
      topK: 12,
    });
    expect(out.picks.map((p) => [p.id, p.via])).toEqual([
      ['m01', 'pinned'],
      ['m02', 'lexical'],
    ]);
  });
});

describe('selectMemories: memori tersemat melebihi jatahnya', () => {
  it('tersemat hanya memakai separuh anggaran; yang tidak muat dihitung, sisanya untuk cocok kata dan terbaru', () => {
    const active = [
      fact(1, 200, { pinned: true }),
      fact(2, 200, { pinned: true }),
      fact(3, 100, { pinned: true }),
      fact(4, 150),
      fact(5, 150),
      fact(6, 150),
    ];
    const out = selectMemories({ active, lexical: ['m05'], budgetChars: 600, topK: 12 });
    // Separuh anggaran = 300: m01 (200) masuk, m02 (200) tidak muat, m03 (100) masih muat.
    expect(out.picks.map((p) => [p.id, p.via])).toEqual([
      ['m01', 'pinned'],
      ['m03', 'pinned'],
      ['m05', 'lexical'],
      ['m06', 'recent'],
    ]);
    expect(out.pinnedDropped).toBe(1);
    expect(cost(out.picks)).toBeLessThanOrEqual(600);
  });

  it('memori tersemat yang tidak muat tidak pernah masuk lewat jalur terbaru', () => {
    const active = [fact(1, 400, { pinned: true, updated: 99 }), fact(2, 100), fact(3, 100)];
    const out = selectMemories({ active, lexical: [], budgetChars: 500, topK: 12 });
    expect(ids(out.picks)).toEqual(['m03', 'm02']);
    expect(out.pinnedDropped).toBe(1);
  });
});
