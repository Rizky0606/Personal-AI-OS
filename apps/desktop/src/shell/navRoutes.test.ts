import { describe, expect, it } from 'vitest';
import { copy } from '../copy';
import { NAV_ROUTES, routeForSlot, shortcutHint } from './navRoutes';
import { shortcutFor } from './useShortcuts';

describe('pintasan pindah layar (satu sumber)', () => {
  it('Ctrl+1..6 mengikuti urutan rail: Chat, Project, Kanban, Jadwal, Riset, Pengaturan', () => {
    expect(NAV_ROUTES).toEqual([
      '/',
      '/workspace',
      '/kanban',
      '/schedules',
      '/research',
      '/settings',
    ]);
    expect([1, 2, 3, 4, 5, 6].map(routeForSlot)).toEqual([...NAV_ROUTES]);
  });

  it('slot di luar jangkauan tidak punya tujuan', () => {
    expect(routeForSlot(0)).toBeUndefined();
    expect(routeForSlot(NAV_ROUTES.length + 1)).toBeUndefined();
  });

  it('petunjuk pintasan diturunkan dari pemetaan yang sama; layar tanpa pintasan tidak punya petunjuk', () => {
    expect(shortcutHint('/')).toBe('Ctrl+1');
    expect(shortcutHint('/kanban')).toBe('Ctrl+3');
    expect(shortcutHint('/settings')).toBe('Ctrl+6');
    expect(shortcutHint('/quota')).toBeUndefined();
  });

  it('pendengar keyboard hanya menerima digit yang punya tujuan', () => {
    const press = (key: string) =>
      shortcutFor({ key, ctrlKey: true, metaKey: false, altKey: false, shiftKey: false });
    for (let slot = 1; slot <= NAV_ROUTES.length; slot++)
      expect(press(String(slot))).toBe('navigate');
    expect(press(String(NAV_ROUTES.length + 1))).toBeNull();
    expect(press('0')).toBeNull();
  });

  it('daftar pintasan di Pengaturan menyebut rentang dan urutan layar yang sama', () => {
    expect(copy.shortcuts.navigate).toContain(`Ctrl+1…${NAV_ROUTES.length}`);
    const names = [
      copy.nav.chat,
      copy.nav.workspace,
      copy.nav.kanban,
      copy.nav.schedules,
      copy.nav.research,
      copy.nav.settings,
    ];
    const positions = names.map((n) => copy.shortcuts.navigate.indexOf(n));
    expect(positions.every((i) => i >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });
});
