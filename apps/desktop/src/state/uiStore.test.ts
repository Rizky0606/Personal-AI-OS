import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyReduceMotion,
  RIGHT_PANEL_DEFAULT,
  RIGHT_PANEL_MAX,
  RIGHT_PANEL_MIN,
  applyTheme,
  clampPanelWidth,
  useUiStore,
} from './uiStore';

beforeEach(() => {
  useUiStore.setState(useUiStore.getInitialState(), true);
});

describe('pembagian panel kanan', () => {
  it('tanpa pembagian, membuka panel mengganti tab tunggal; setelah dibagi, tab ditampilkan di pane', () => {
    const ui = useUiStore.getState();
    ui.openPanel('terminal');
    expect(useUiStore.getState()).toMatchObject({ rightPanelTab: 'terminal', paneTree: null });

    ui.splitPane('root', 'column');
    const tree = useUiStore.getState().paneTree;
    expect(tree).toMatchObject({ type: 'split', direction: 'column' });

    // Diff belum tampil: mengganti pane pertama; yang sudah tampil tidak berubah.
    useUiStore.getState().openReview('run-1');
    const tabs = () =>
      JSON.stringify(useUiStore.getState().paneTree)
        .match(/"tab":"(\w+)"/g)
        ?.join(',');
    expect(tabs()).toBe('"tab":"diff","tab":"preview"');
    useUiStore.getState().openPanel('preview');
    expect(tabs()).toBe('"tab":"diff","tab":"preview"');
  });

  it('tersimpan dan dipulihkan; pohon rusak di penyimpanan dibuang', async () => {
    useUiStore.getState().splitPane('root', 'row');
    const saved = JSON.parse(localStorage.getItem('aios.ui') ?? '{}') as {
      state: { paneTree: unknown };
    };
    expect(saved.state.paneTree).toMatchObject({ type: 'split', direction: 'row' });

    localStorage.setItem(
      'aios.ui',
      JSON.stringify({ state: { paneTree: { type: 'split', id: 'x' } }, version: 1 }),
    );
    await useUiStore.persist.rehydrate();
    expect(useUiStore.getState().paneTree).toBeNull();
  });
});

describe('lebar panel kanan', () => {
  it('dijepit ke batas dan membulat; nilai tak sah kembali ke bawaan', () => {
    expect(clampPanelWidth(10)).toBe(RIGHT_PANEL_MIN);
    expect(clampPanelWidth(5000)).toBe(RIGHT_PANEL_MAX);
    expect(clampPanelWidth(400.6)).toBe(401);
    expect(clampPanelWidth(Number.NaN)).toBe(RIGHT_PANEL_DEFAULT);
  });

  it('diingat di localStorage dan dipulihkan; nilai rusak dijepit', async () => {
    useUiStore.getState().setRightPanelWidth(555);
    useUiStore.getState().setRightPanelTab('terminal');
    useUiStore.getState().toggleRightPanel();
    const saved = JSON.parse(localStorage.getItem('aios.ui') ?? '{}') as {
      state: Record<string, unknown>;
    };
    expect(saved.state).toMatchObject({
      rightPanelWidth: 555,
      rightPanelTab: 'terminal',
      rightPanelOpen: true,
    });

    localStorage.setItem(
      'aios.ui',
      JSON.stringify({
        state: { rightPanelWidth: 99_999, theme: 'dark', sidebarOpen: false },
        version: 1,
      }),
    );
    await useUiStore.persist.rehydrate();
    expect(useUiStore.getState()).toMatchObject({
      rightPanelWidth: RIGHT_PANEL_MAX,
      theme: 'dark',
      sidebarOpen: false,
    });
  });

  it('keadaan sementara (palet, sinyal chat baru) tidak ikut disimpan', () => {
    useUiStore.getState().setPaletteOpen(true);
    useUiStore.getState().requestNewChat();
    useUiStore.getState().toggleSidebar();
    const saved = JSON.parse(localStorage.getItem('aios.ui') ?? '{}') as {
      state: Record<string, unknown>;
    };
    expect(saved.state).not.toHaveProperty('paletteOpen');
    expect(saved.state).not.toHaveProperty('newChatSignal');
  });
});

describe('tema', () => {
  it('terang/gelap memasang data-theme; ikut sistem melepasnya', () => {
    const root = document.createElement('html');
    applyTheme('dark', root);
    expect(root.getAttribute('data-theme')).toBe('dark');
    applyTheme('light', root);
    expect(root.getAttribute('data-theme')).toBe('light');
    applyTheme('system', root);
    expect(root.hasAttribute('data-theme')).toBe(false);
  });
});

describe('kurangi gerakan', () => {
  it('eksplisit memasang data-reduce-motion; null (ikut sistem) melepasnya', () => {
    const root = document.createElement('html');
    applyReduceMotion(true, root);
    expect(root.getAttribute('data-reduce-motion')).toBe('true');
    applyReduceMotion(false, root);
    expect(root.getAttribute('data-reduce-motion')).toBe('false');
    applyReduceMotion(null, root);
    expect(root.hasAttribute('data-reduce-motion')).toBe(false);
  });
});
