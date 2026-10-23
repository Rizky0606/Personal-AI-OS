import { act, fireEvent, render, screen } from '@testing-library/react';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { copy } from '../copy';
import { RIGHT_PANEL_DEFAULT, useUiStore } from '../state/uiStore';
import { TooltipProvider } from '../ui/Tooltip';
import { Shell } from './Shell';

async function renderShell(path = '/') {
  const root = createRootRoute({ component: Shell });
  const paths = ['/', '/projects', '/kanban', '/schedules', '/research', '/settings'];
  const router = createRouter({
    routeTree: root.addChildren(
      paths.map((p) =>
        createRoute({ getParentRoute: () => root, path: p, component: () => <p>isi {p}</p> }),
      ),
    ),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const view = render(
    <TooltipProvider>
      <RouterProvider router={router} />
    </TooltipProvider>,
  );
  await screen.findByRole('navigation', { name: copy.shell.rail });
  return { router, ...view };
}

const ctrl = (key: string) => act(() => void fireEvent.keyDown(window, { key, ctrlKey: true }));

beforeEach(() => {
  useUiStore.setState(useUiStore.getInitialState(), true);
});

describe('Shell', () => {
  it('kerangka final: rail 6 tujuan, sidebar, area utama, dan status bar; panel kanan tertutup', async () => {
    await renderShell();

    const rail = screen.getByRole('navigation', { name: copy.shell.rail });
    const names = Array.from(rail.querySelectorAll('a')).map((a) => a.getAttribute('aria-label'));
    expect(names).toEqual([
      copy.nav.chat,
      copy.nav.projects,
      copy.nav.kanban,
      copy.nav.schedules,
      copy.nav.research,
      copy.nav.settings,
    ]);
    expect(screen.getByRole('complementary', { name: copy.shell.sidebar })).toBeInTheDocument();
    expect(screen.getByRole('main', { name: copy.shell.mainArea })).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toHaveTextContent(copy.status.idle);
    expect(
      screen.queryByRole('complementary', { name: copy.shell.toggleRightPanel }),
    ).not.toBeInTheDocument();
  });

  it('Ctrl+B menutup dan membuka sidebar; tombol di area utama membukanya lagi', async () => {
    await renderShell();

    ctrl('b');
    expect(
      screen.queryByRole('complementary', { name: copy.shell.sidebar }),
    ).not.toBeInTheDocument();
    expect(useUiStore.getState().sidebarOpen).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: copy.shell.expandSidebar }));
    expect(screen.getByRole('complementary', { name: copy.shell.sidebar })).toBeInTheDocument();
  });

  it('Ctrl+J membuka panel kanan dengan 4 tab dan lebar yang diingat', async () => {
    await renderShell();

    ctrl('j');
    const panel = screen.getByRole('complementary', { name: copy.shell.toggleRightPanel });
    expect(panel).toHaveStyle({ width: `${RIGHT_PANEL_DEFAULT}px` });
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(tabs).toEqual([
      copy.shell.panels.preview,
      copy.shell.panels.diff,
      copy.shell.panels.terminal,
      copy.shell.panels.files,
    ]);

    // Radix Tabs aktif pada mousedown.
    fireEvent.mouseDown(screen.getByRole('tab', { name: copy.shell.panels.terminal }));
    expect(useUiStore.getState().rightPanelTab).toBe('terminal');
  });

  it('pegangan panel bisa diubah dengan keyboard dan hasilnya tersimpan', async () => {
    await renderShell();
    ctrl('j');

    const handle = screen.getByRole('separator', { name: copy.shell.resizePanel });
    handle.focus();
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });

    expect(useUiStore.getState().rightPanelWidth).toBe(RIGHT_PANEL_DEFAULT + 32);
    expect(handle).toHaveAttribute('aria-valuenow', String(RIGHT_PANEL_DEFAULT + 32));
  });

  it('Ctrl+K membuka palet perintah yang kosong; Ctrl+N menaikkan sinyal chat baru', async () => {
    await renderShell();

    ctrl('k');
    expect(await screen.findByRole('dialog', { name: copy.shell.palette })).toHaveTextContent(
      copy.shell.paletteHint,
    );

    const before = useUiStore.getState().newChatSignal;
    ctrl('n');
    expect(useUiStore.getState().newChatSignal).toBe(before + 1);
  });

  it('judul bagian dan sidebar mengikuti rute', async () => {
    await renderShell('/research');

    expect(
      await screen.findByRole('heading', { level: 1, name: copy.nav.research }),
    ).toBeInTheDocument();
    expect(screen.getByText(copy.screens.researchEmpty)).toBeInTheDocument();
  });
});
