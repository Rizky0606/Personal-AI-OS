import { describe, expect, it } from 'vitest';
import {
  MAX_PANES,
  ROOT_ID,
  clampRatio,
  closePane,
  countPanes,
  leaves,
  nextTab,
  parsePaneTree,
  revealTab,
  setLeafTab,
  setSplitRatio,
  splitPane,
  type PaneNode,
} from './tree';

const root: PaneNode = { type: 'leaf', id: ROOT_ID, tab: 'preview' };
let n = 0;
const ids = () => ({ split: `s${++n}`, leaf: `l${n}` });

describe('pohon pane', () => {
  it('membagi pane: pane baru di sisi kedua dengan tab yang belum tampil', () => {
    const tree = splitPane(root, ROOT_ID, 'row', { split: 's', leaf: 'l' });
    expect(tree).toEqual({
      type: 'split',
      id: 's',
      direction: 'row',
      ratio: 0.5,
      first: root,
      second: { type: 'leaf', id: 'l', tab: 'diff' },
    });
  });

  it('membagi pane di dalam pohon dan menutupnya kembali mengembalikan saudaranya', () => {
    let tree = splitPane(root, ROOT_ID, 'row', { split: 's1', leaf: 'a' });
    tree = splitPane(tree, 'a', 'column', { split: 's2', leaf: 'b' });
    expect(leaves(tree).map((l) => l.id)).toEqual([ROOT_ID, 'a', 'b']);
    expect(leaves(tree).map((l) => l.tab)).toEqual(['preview', 'diff', 'terminal']);

    tree = closePane(tree, 'b');
    expect(leaves(tree).map((l) => l.id)).toEqual([ROOT_ID, 'a']);
    tree = closePane(tree, ROOT_ID);
    expect(tree).toEqual({ type: 'leaf', id: 'a', tab: 'diff' });
    expect(closePane(tree, 'a')).toBe(tree);
  });

  it(`maksimal ${MAX_PANES} pane`, () => {
    let tree: PaneNode = root;
    for (let i = 0; i < MAX_PANES + 3; i++) {
      tree = splitPane(tree, leaves(tree).at(-1)!.id, i % 2 ? 'row' : 'column', ids());
    }
    expect(countPanes(tree)).toBe(MAX_PANES);
  });

  it('tab pane baru jatuh ke tab sumber bila semua tab sudah tampil', () => {
    let tree: PaneNode = root;
    for (let i = 0; i < 5; i++) tree = splitPane(tree, leaves(tree).at(-1)!.id, 'row', ids());
    expect(nextTab(tree, 'files')).toBe('files');
  });

  it('mengganti tab, mengubah rasio (dibatasi), dan menampilkan tab', () => {
    const tree = splitPane(root, ROOT_ID, 'row', { split: 's', leaf: 'l' });
    expect(leaves(setLeafTab(tree, 'l', 'terminal')).map((x) => x.tab)).toEqual([
      'preview',
      'terminal',
    ]);
    expect((setSplitRatio(tree, 's', 0.99) as { ratio: number }).ratio).toBe(0.85);
    expect(clampRatio(Number.NaN)).toBe(0.5);

    expect(revealTab(tree, 'diff')).toBe(tree);
    expect(leaves(revealTab(tree, 'files')).map((x) => x.tab)).toEqual(['files', 'diff']);
  });

  it('parsePaneTree menerima pohon sah dan menolak data rusak', () => {
    const tree = splitPane(root, ROOT_ID, 'column', { split: 's', leaf: 'l' });
    expect(parsePaneTree(JSON.parse(JSON.stringify(tree)))).toEqual(tree);
    expect(parsePaneTree(null)).toBeNull();
    expect(parsePaneTree({ type: 'leaf', id: 'x', tab: 'lain' })).toBeNull();
    expect(parsePaneTree({ ...tree, direction: 'diagonal' })).toBeNull();
    expect(
      parsePaneTree({ ...tree, second: { type: 'leaf', id: ROOT_ID, tab: 'diff' } }),
    ).toBeNull();
    expect(parsePaneTree({ ...tree, ratio: 5 })).toMatchObject({ ratio: 0.85 });
  });
});
