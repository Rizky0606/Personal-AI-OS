import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../copy';
import { useUiStore } from '../state/uiStore';
import { resetApi } from '../test/fakeServices';
import { renderScreen } from '../test/render';
import { PaneArea } from './PaneArea';

vi.mock('../app/services', async () => (await import('../test/fakeServices')).fakeServices);

// jsdom tidak punya tata letak: lebar slot tab dan lebar alami deret disimulasikan, ResizeObserver dipicu manual.
const size = { available: 0, needed: 0 };
let notify: (() => void) | undefined;

beforeEach(() => {
  resetApi();
  useUiStore.setState(useUiStore.getInitialState(), true);
  useUiStore.setState({ rightPanelTab: 'progress' });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const width = this.hasAttribute('data-pane-tabs')
      ? size.available
      : this.getAttribute('role') === 'tablist'
        ? size.needed
        : 0;
    return { width, height: 0, x: 0, y: 0, top: 0, left: 0, right: width, bottom: 0 } as DOMRect;
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        notify = callback;
      }
      observe = vi.fn();
      disconnect = vi.fn();
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  notify = undefined;
});

const resize = (available: number) =>
  act(() => {
    size.available = available;
    notify?.();
  });
const layout = () => document.querySelector('[data-pane-tabs]')?.getAttribute('data-pane-tabs');

describe('PaneArea: tata letak tab mengikuti ruang nyata', () => {
  it('lebar: deret penuh; tidak muat: ringkas dengan dropdown; kembali penuh hanya setelah lewat histeresis', async () => {
    size.needed = 325;
    size.available = 400;
    await renderScreen(<PaneArea />);
    expect(layout()).toBe('full');
    expect(screen.queryByRole('button', { name: copy.panes.switchTab })).toBeNull();

    // Pas tepat di batas: masih penuh (tanpa gulir karena deret tidak pernah lebih lebar dari slot).
    resize(325);
    expect(layout()).toBe('full');

    // Kurang 1 px (dulu: pill bergulir mendatar di antara 300 px dan lebar deret): kini ringkas.
    resize(324);
    expect(layout()).toBe('compact');
    expect(screen.getByRole('button', { name: copy.panes.switchTab })).toBeInTheDocument();

    // Di batas, tetap ringkas sampai ada sisa 8 px: tidak berkedip saat panel digeser sedikit.
    resize(330);
    expect(layout()).toBe('compact');
    resize(333);
    expect(layout()).toBe('full');
  });

  it('fokus keyboard pindah ke padanannya saat tata letak berganti, tidak jatuh ke body', async () => {
    size.needed = 325;
    size.available = 400;
    await renderScreen(<PaneArea />);
    const active = screen.getByRole('tab', { selected: true });
    active.focus();

    resize(300);
    const switcher = screen.getByRole('button', { name: copy.panes.switchTab });
    await waitFor(() => expect(switcher).toHaveFocus());

    resize(400);
    await waitFor(() => expect(screen.getByRole('tab', { selected: true })).toHaveFocus());
  });
});
