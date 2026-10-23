export type PaletteGroup =
  'action' | 'go' | 'conversation' | 'project' | 'task' | 'schedule' | 'model' | 'theme' | 'panel';

export interface PaletteItem {
  id: string;
  group: PaletteGroup;
  label: string;
  /** Teks pendukung yang ikut dicari dan ditampilkan redup (mis. status kartu). */
  hint?: string | undefined;
  /** Kata kunci tambahan yang dicari tetapi tidak ditampilkan. */
  keywords?: string | undefined;
  run: () => void;
}

/** Urutan grup di daftar hasil. */
export const GROUP_ORDER: PaletteGroup[] = [
  'action',
  'go',
  'panel',
  'conversation',
  'task',
  'schedule',
  'project',
  'model',
  'theme',
];

const normalize = (text: string) => text.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '');

/**
 * Skor kecocokan 0 (tidak cocok) sampai 4: label diawali query (4), kata di label diawali query (3),
 * label memuat query (2), hint/kata kunci memuat query atau semua kata query ada (1).
 */
export function score(item: PaletteItem, query: string): number {
  const q = normalize(query.trim());
  if (!q) return 1;
  const label = normalize(item.label);
  if (label.startsWith(q)) return 4;
  if (label.split(/[\s/\-_.·]+/).some((word) => word.startsWith(q))) return 3;
  if (label.includes(q)) return 2;
  const rest = normalize(`${item.hint ?? ''} ${item.keywords ?? ''}`);
  if (rest.includes(q)) return 1;
  // Semua kata query muncul di mana saja ("pindah toko").
  const words = q.split(/\s+/);
  const haystack = `${label} ${rest}`;
  return words.length > 1 && words.every((w) => haystack.includes(w)) ? 1 : 0;
}

export const MAX_PER_GROUP = 6;

/**
 * Menyaring dan mengurutkan item: dalam grup menurut skor lalu urutan sumber, grup menurut GROUP_ORDER.
 * Query kosong menampilkan perintah dan navigasi saja (tanpa daftar panjang percakapan/kartu).
 */
export function rank(items: readonly PaletteItem[], query: string): PaletteItem[] {
  const empty = query.trim() === '';
  const scored = items
    .map((item, index) => ({ item, index, value: score(item, query) }))
    .filter(({ value }) => value > 0);
  const out: PaletteItem[] = [];
  for (const group of GROUP_ORDER) {
    const inGroup = scored
      .filter(({ item }) => item.group === group)
      .sort((a, b) => b.value - a.value || a.index - b.index)
      .map(({ item }) => item);
    if (empty && !['action', 'go', 'panel'].includes(group)) continue;
    out.push(...inGroup.slice(0, empty ? inGroup.length : MAX_PER_GROUP));
  }
  return out;
}
