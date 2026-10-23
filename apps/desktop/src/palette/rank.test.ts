import { describe, expect, it, vi } from 'vitest';
import { MAX_PER_GROUP, rank, score, type PaletteGroup, type PaletteItem } from './rank';

const item = (
  id: string,
  group: PaletteGroup,
  label: string,
  over: Partial<PaletteItem> = {},
): PaletteItem => ({
  id,
  group,
  label,
  run: vi.fn(),
  ...over,
});

describe('score', () => {
  it('awalan label > awal kata > memuat > hint/kata kunci > tidak cocok', () => {
    const a = item('a', 'action', 'Chat baru');
    expect(score(a, 'chat')).toBe(4);
    expect(score(a, 'bar')).toBe(3);
    expect(score(a, 'hat')).toBe(2);
    expect(score(item('b', 'action', 'Buka', { hint: 'Ctrl+N' }), 'ctrl')).toBe(1);
    expect(score(item('c', 'theme', 'Tema gelap', { keywords: 'warna' }), 'warna')).toBe(1);
    expect(score(a, 'xyz')).toBe(0);
  });

  it('tidak peka huruf besar/kecil dan aksen; semua kata query boleh tersebar', () => {
    expect(score(item('a', 'action', 'Jadwal Berita'), 'JADWAL')).toBe(4);
    expect(score(item('b', 'action', 'Café'), 'cafe')).toBe(4);
    expect(score(item('c', 'project', 'Pindah ke project Toko Online'), 'online pindah')).toBe(1);
  });
});

describe('rank', () => {
  const items = [
    item('c1', 'conversation', 'Rencana rilis'),
    item('c2', 'conversation', 'Tes rilis'),
    item('t1', 'task', 'Perbaiki rilis otomatis'),
    item('a1', 'action', 'Chat baru'),
    item('g1', 'go', 'Kanban'),
    item('p1', 'panel', 'Buka panel Terminal'),
  ];

  it('query kosong: hanya perintah, navigasi, dan panel (tanpa daftar percakapan atau kartu)', () => {
    expect(rank(items, '').map((i) => i.id)).toEqual(['a1', 'g1', 'p1']);
  });

  it('dikelompokkan menurut urutan grup; dalam grup menurut skor lalu urutan sumber', () => {
    const result = rank(items, 'rilis');
    expect(result.map((i) => i.id)).toEqual(['c1', 'c2', 't1']);
    expect(rank(items, 'ter').map((i) => i.id)).toEqual(['p1']);
  });

  it('skor lebih tinggi menang di dalam grup yang sama', () => {
    const list = [
      item('x', 'conversation', 'Catatan rilis'),
      item('y', 'conversation', 'Rilis minggu ini'),
    ];
    expect(rank(list, 'rilis').map((i) => i.id)).toEqual(['y', 'x']);
  });

  it('dibatasi MAX_PER_GROUP per grup saat mencari', () => {
    const many = Array.from({ length: 20 }, (_, i) => item(`k${i}`, 'conversation', `Rilis ${i}`));
    expect(rank(many, 'rilis')).toHaveLength(MAX_PER_GROUP);
  });

  it('tidak ada yang cocok: kosong', () => {
    expect(rank(items, 'zzzz')).toEqual([]);
  });
});
