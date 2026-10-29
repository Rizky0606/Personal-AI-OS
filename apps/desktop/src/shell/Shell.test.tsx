import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../copy';
import { RIGHT_PANEL_DEFAULT, useUiStore } from '../state/uiStore';
import { resetApi } from '../test/fakeServices';
import { TooltipProvider } from '../ui/Tooltip';

vi.mock('../app/services', async () => (await import('../test/fakeServices')).fakeServices);

const { Shell } = await import('./Shell');

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
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  await screen.findByRole('navigation', { name: copy.shell.navigation });
  return { router, ...view };
}

const ctrl = (key: string) => act(() => void fireEvent.keyDown(window, { key, ctrlKey: true }));

beforeEach(() => {
  resetApi();
  useUiStore.setState(useUiStore.getInitialState(), true);
});

describe('Shell', () => {
  it('kerangka: satu sidebar dengan 6 bagian dan Pengaturan, header, dan area utama; tanpa status bar; panel kanan tertutup', async () => {
    await renderShell();

    const nav = screen.getByRole('navigation', { name: copy.shell.navigation });
    const names = Array.from(nav.querySelectorAll('a')).map((a) => a.getAttribute('aria-label'));
    expect(names).toEqual([
      copy.nav.chat,
      copy.nav.workspace,
      copy.nav.kanban,
      copy.nav.schedules,
      copy.nav.research,
      copy.nav.spaces,
    ]);
    const sidebar = screen.getByRole('complementary', { name: copy.shell.sidebar });
    expect(within(sidebar).getByRole('link', { name: copy.nav.settings })).toBeInTheDocument();
    expect(within(sidebar).getByRole('link', { name: copy.nav.chat })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('main', { name: copy.shell.mainArea })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: copy.nav.chat })).toBeInTheDocument();
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument();
    // Status koneksi pindah ke kaki sidebar.
    expect(within(sidebar).getByText(copy.status.idle)).toBeInTheDocument();
    expect(
      screen.queryByRole('complementary', { name: copy.shell.toggleRightPanel }),
    ).not.toBeInTheDocument();
  });

  it('Ctrl+B menciutkan sidebar jadi ikon dan membukanya lagi; tombol di header membukanya', async () => {
    await renderShell();
    const sidebar = screen.getByRole('complementary', { name: copy.shell.sidebar });
    expect(screen.getByRole('button', { name: copy.shell.collapseSidebar })).toBeInTheDocument();
    expect(within(sidebar).getByText(copy.shell.search)).toBeInTheDocument();

    ctrl('b');
    expect(useUiStore.getState().sidebarOpen).toBe(false);
    // Ciut: tetap ada navigasi (ikon), tanpa teks pencarian dan daftar konteks.
    expect(screen.getByRole('navigation', { name: copy.shell.navigation })).toBeInTheDocument();
    expect(within(sidebar).queryByText(copy.shell.search)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: copy.shell.collapseSidebar }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: copy.shell.expandSidebar }));
    expect(useUiStore.getState().sidebarOpen).toBe(true);
    expect(within(sidebar).getByText(copy.shell.search)).toBeInTheDocument();
  });

  it('Ctrl+J membuka panel kanan dengan 6 tab dan lebar yang diingat', async () => {
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
      copy.shell.panels.git,
      copy.shell.panels.activity,
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

  it('panel kanan bisa dibagi: pane baru menampilkan tab lain, bisa diubah ukurannya dan ditutup', async () => {
    await renderShell();
    ctrl('j');
    expect(screen.queryByRole('separator', { name: copy.panes.resize })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: copy.panes.close })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: copy.panes.splitRow }));
    expect(screen.getAllByRole('tablist')).toHaveLength(2);
    expect(screen.getAllByRole('tab', { selected: true }).map((t) => t.textContent)).toEqual([
      copy.shell.panels.preview,
      copy.shell.panels.diff,
    ]);

    const handle = screen.getByRole('separator', { name: copy.panes.resize });
    expect(handle).toHaveAttribute('aria-valuenow', '50');
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(handle).toHaveAttribute('aria-valuenow', '55');
    for (let i = 0; i < 20; i++) fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(handle).toHaveAttribute('aria-valuenow', '85');

    // Pembagian disimpan; menutup salah satu pane mengembalikan mode tab tunggal.
    expect(useUiStore.getState().paneTree).not.toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: copy.panes.close })[0]!);
    expect(screen.getAllByRole('tablist')).toHaveLength(1);
    expect(useUiStore.getState().paneTree).toBeNull();
    expect(useUiStore.getState().rightPanelTab).toBe('diff');
  });

  it('Ctrl+K membuka palet perintah; Ctrl+N menaikkan sinyal chat baru', async () => {
    await renderShell();

    ctrl('k');
    expect(await screen.findByRole('dialog', { name: copy.palette.title })).toHaveTextContent(
      copy.palette.newChat,
    );

    const before = useUiStore.getState().newChatSignal;
    ctrl('n');
    expect(useUiStore.getState().newChatSignal).toBe(before + 1);
  });

  it('Ctrl+1..6 berpindah layar sesuai urutan sidebar, tanpa mouse', async () => {
    const { router } = await renderShell();

    for (const [digit, path] of [
      ['3', '/kanban'],
      ['4', '/schedules'],
      ['6', '/settings'],
      ['2', '/workspace'],
      ['1', '/'],
    ] as const) {
      ctrl(digit);
      await waitFor(() => expect(router.state.location.pathname).toBe(path));
    }
  });

  it('judul bagian dan sidebar mengikuti rute', async () => {
    await renderShell('/research');

    expect(
      await screen.findByRole('heading', { level: 1, name: copy.nav.research }),
    ).toBeInTheDocument();
    expect(await screen.findByText(copy.research.listEmpty)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: copy.research.newResearch })).toBeInTheDocument();
  });

  it('sidebar chat menampilkan percakapan dari server dan tombol Chat baru', async () => {
    const { api } = await import('../test/fakeServices');
    api.listConversations.mockResolvedValue({
      items: [
        {
          id: '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f',
          title: 'Rencana rilis',
          surface: 'windows',
          projectId: null,
          spaceId: null,
          pinned: false,
          archivedAt: null,
          createdAt: '2026-10-22T06:38:00Z',
          updatedAt: '2026-10-22T06:38:00Z',
        },
      ],
      nextBefore: null,
    });
    await renderShell();

    expect(await screen.findByText('Rencana rilis')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: copy.chat.newChat })).toBeInTheDocument();
  });

  it('Chat baru dari sidebar menaikkan sinyal chat baru', async () => {
    await renderShell();
    const before = useUiStore.getState().newChatSignal;

    fireEvent.click(screen.getByRole('button', { name: copy.chat.newChat }));

    expect(useUiStore.getState().newChatSignal).toBe(before + 1);
  });
});
