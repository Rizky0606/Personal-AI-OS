export type PaneTab = 'preview' | 'diff' | 'terminal' | 'files' | 'git' | 'activity';

export const PANE_TABS: PaneTab[] = ['preview', 'diff', 'terminal', 'files', 'git', 'activity'];

export type SplitDirection = 'row' | 'column';

export interface PaneLeaf {
  type: 'leaf';
  id: string;
  tab: PaneTab;
}

export interface PaneSplit {
  type: 'split';
  id: string;
  /** `row`: dua pane berdampingan; `column`: satu di atas yang lain. */
  direction: SplitDirection;
  /** Bagian pane pertama (0..1). */
  ratio: number;
  first: PaneNode;
  second: PaneNode;
}

export type PaneNode = PaneLeaf | PaneSplit;

export const MAX_PANES = 6;
export const MIN_RATIO = 0.15;
export const MAX_RATIO = 0.85;
export const ROOT_ID = 'root';

export const clampRatio = (ratio: number): number =>
  Math.min(MAX_RATIO, Math.max(MIN_RATIO, Number.isFinite(ratio) ? ratio : 0.5));

export function leaves(node: PaneNode): PaneLeaf[] {
  return node.type === 'leaf' ? [node] : [...leaves(node.first), ...leaves(node.second)];
}

export const countPanes = (node: PaneNode): number => leaves(node).length;

/** Tab untuk pane baru: yang belum tampil di pane lain; bila semuanya sudah tampil, sama dengan sumbernya. */
export function nextTab(node: PaneNode, source: PaneTab): PaneTab {
  const used = new Set(leaves(node).map((l) => l.tab));
  return PANE_TABS.find((t) => !used.has(t)) ?? source;
}

/** Membagi pane menjadi dua; pane baru ada di sisi kedua. Tidak berubah bila sudah mencapai batas. */
export function splitPane(
  node: PaneNode,
  leafId: string,
  direction: SplitDirection,
  ids: { split: string; leaf: string },
): PaneNode {
  if (countPanes(node) >= MAX_PANES) return node;
  const fresh = nextTab(node, leaves(node).find((l) => l.id === leafId)?.tab ?? 'preview');
  const walk = (n: PaneNode): PaneNode => {
    if (n.type === 'leaf') {
      return n.id === leafId
        ? {
            type: 'split',
            id: ids.split,
            direction,
            ratio: 0.5,
            first: n,
            second: { type: 'leaf', id: ids.leaf, tab: fresh },
          }
        : n;
    }
    return { ...n, first: walk(n.first), second: walk(n.second) };
  };
  return walk(node);
}

/** Menutup pane; saudaranya mengambil seluruh ruangnya. Pane terakhir tidak bisa ditutup. */
export function closePane(node: PaneNode, leafId: string): PaneNode {
  if (node.type === 'leaf') return node;
  if (node.first.type === 'leaf' && node.first.id === leafId) return node.second;
  if (node.second.type === 'leaf' && node.second.id === leafId) return node.first;
  return { ...node, first: closePane(node.first, leafId), second: closePane(node.second, leafId) };
}

export function setLeafTab(node: PaneNode, leafId: string, tab: PaneTab): PaneNode {
  if (node.type === 'leaf') return node.id === leafId ? { ...node, tab } : node;
  return {
    ...node,
    first: setLeafTab(node.first, leafId, tab),
    second: setLeafTab(node.second, leafId, tab),
  };
}

export function setSplitRatio(node: PaneNode, splitId: string, ratio: number): PaneNode {
  if (node.type === 'leaf') return node;
  return node.id === splitId
    ? { ...node, ratio: clampRatio(ratio) }
    : {
        ...node,
        first: setSplitRatio(node.first, splitId, ratio),
        second: setSplitRatio(node.second, splitId, ratio),
      };
}

/** Menampilkan tab di salah satu pane: tidak berubah bila sudah tampil, selain itu mengganti pane pertama. */
export function revealTab(node: PaneNode, tab: PaneTab): PaneNode {
  const all = leaves(node);
  if (all.some((l) => l.tab === tab)) return node;
  const first = all[0];
  return first ? setLeafTab(node, first.id, tab) : node;
}

const isTab = (v: unknown): v is PaneTab => PANE_TABS.includes(v as PaneTab);

/** Memeriksa pohon dari penyimpanan lokal; data rusak, terlalu dalam, atau terlalu banyak pane ditolak. */
export function parsePaneTree(value: unknown): PaneNode | null {
  const seen = new Set<string>();
  const walk = (v: unknown, depth: number): PaneNode | null => {
    if (depth > MAX_PANES || typeof v !== 'object' || v === null) return null;
    const n = v as Record<string, unknown>;
    if (typeof n.id !== 'string' || n.id === '' || seen.has(n.id)) return null;
    seen.add(n.id);
    if (n.type === 'leaf') return isTab(n.tab) ? { type: 'leaf', id: n.id, tab: n.tab } : null;
    if (n.type !== 'split') return null;
    if (n.direction !== 'row' && n.direction !== 'column') return null;
    if (typeof n.ratio !== 'number') return null;
    const first = walk(n.first, depth + 1);
    const second = walk(n.second, depth + 1);
    if (!first || !second) return null;
    return {
      type: 'split',
      id: n.id,
      direction: n.direction,
      ratio: clampRatio(n.ratio),
      first,
      second,
    };
  };
  const tree = walk(value, 0);
  return tree && countPanes(tree) <= MAX_PANES ? tree : null;
}
