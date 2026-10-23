import { beforeEach, describe, expect, it } from 'vitest';
import {
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
