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
  await screen.findByRole('navigation', { name: copy.shell.rail });
  return { router, ...view };
}

const ctrl = (key: string) => act(() => void fireEvent.keyDown(window, { key, ctrlKey: true }));

beforeEach(() => {
  resetApi();
  useUiStore.setState(useUiStore.getInitialState(), true);
});

describe('Shell', () => {
  it('kerangka pulau: navigasi 7 tujuan, sidebar, area utama, kaki status, dan indikator koneksi di topbar; panel kanan tertutup', async () => {
    await renderShell();

    const rail = screen.getByRole('navigation', { name: copy.shell.rail });
    const names = Array.from(rail.querySelectorAll('a')).map((a) => a.getAttribute('aria-label'));
    expect(names).toEqual([
      copy.nav.chat,
      copy.nav.workspace,
      copy.nav.kanban,
      copy.nav.schedules,
      copy.nav.research,
      copy.nav.spaces,
      copy.nav.settings,
    ]);
    expect(screen.getByRole('complementary', { name: copy.shell.sidebar })).toBeInTheDocument();
    expect(screen.getByRole('main', { name: copy.shell.mainArea })).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    // Indikator koneksi pindah ke topbar (teks + titik berwarna status), bukan di kaki.
    expect(within(screen.getByRole('main')).getByRole('status')).toHaveTextContent(
      copy.status.idle,
    );
    expect(screen.getByRole('contentinfo')).not.toHaveTextContent(copy.status.idle);
    expect(
      screen.queryByRole('complementary', { name: copy.shell.toggleRightPanel }),
    ).not.toBeInTheDocument();
  });

  it('Ctrl+B meringkas sidebar menjadi hanya ikon (navigasi tetap, daftar konteks disembunyikan); tombol di sidebar membukanya lagi', async () => {
    await renderShell();
    const sidebar = () => screen.getByRole('complementary', { name: copy.shell.sidebar });
    expect(sidebar()).toHaveAttribute('data-compact', 'false');
    expect(within(sidebar()).getByRole('heading', { level: 2 })).toBeInTheDocument();

    ctrl('b');
    expect(useUiStore.getState().sidebarOpen).toBe(false);
    expect(sidebar()).toHaveAttribute('data-compact', 'true');
    // Navigasi tetap lengkap dengan nama yang sama; daftar konteks hilang.
    expect(within(sidebar()).getAllByRole('link')).toHaveLength(7);
    expect(within(sidebar()).getByRole('link', { name: copy.nav.kanban })).toBeInTheDocument();
    expect(within(sidebar()).queryByRole('heading', { level: 2 })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: copy.shell.expandSidebar }));
    expect(sidebar()).toHaveAttribute('data-compact', 'false');
    expect(useUiStore.getState().sidebarOpen).toBe(true);
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

  it('Ctrl+1..6 berpindah layar sesuai urutan rail, tanpa mouse', async () => {
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

  it('panel kanan membuka dengan animasi lebar, menutup menyempit dulu (inert) lalu dilepas setelah 240 ms', async () => {
    await renderShell();
    const panel = () => screen.queryByRole('complementary', { name: copy.shell.toggleRightPanel });

    ctrl('j');
    expect(panel()).toHaveClass('aios-panel-open');
    expect(panel()).not.toHaveAttribute('inert');
    // Isi sidebar dan area utama tidak dipasang ulang saat panel membuka.
    expect(screen.getByRole('main', { name: copy.shell.mainArea })).toBeInTheDocument();

    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      ctrl('j');
      expect(panel()).toHaveClass('aios-panel-close');
      expect(panel()).toHaveAttribute('inert');
      // Pegangan ubah-lebar hilang selama menutup; panel masih ada sampai animasinya selesai.
      expect(
        screen.queryByRole('separator', { name: copy.shell.resizePanel }),
      ).not.toBeInTheDocument();

      act(() => void vi.advanceTimersByTime(239));
      expect(panel()).toBeInTheDocument();
      act(() => void vi.advanceTimersByTime(2));
      expect(panel()).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('membuka ulang saat masih menutup membatalkan pelepasan panel', async () => {
    await renderShell();
    ctrl('j');
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      ctrl('j');
      ctrl('j');
      act(() => void vi.advanceTimersByTime(500));
      const panel = screen.getByRole('complementary', { name: copy.shell.toggleRightPanel });
      expect(panel).toHaveClass('aios-panel-open');
    } finally {
      vi.useRealTimers();
    }
  });

  it('tab panel: yang aktif menampilkan label, yang lain ikon dengan nama aksesibel dan tooltip; semua punya ikon', async () => {
    await renderShell();
    ctrl('j');

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(6);
    for (const tab of tabs) expect(tab.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    const active = screen.getByRole('tab', { selected: true });
    expect(within(active).getByText(copy.shell.panels.preview)).not.toHaveClass('sr-only');
    const diff = screen.getByRole('tab', { name: copy.shell.panels.diff });
    expect(within(diff).getByText(copy.shell.panels.diff)).toHaveClass('sr-only');

    diff.focus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent(copy.shell.panels.diff);
  });

  it('tab panel dengan keyboard: panah menggeser fokus dan tab aktif tanpa kehilangan fokus', async () => {
    await renderShell();
    ctrl('j');

    const first = screen.getByRole('tab', { selected: true });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });

    const next = screen.getByRole('tab', { name: copy.shell.panels.diff });
    // Radix memindahkan fokus roving secara tertunda (setTimeout), jadi tunggu.
    await waitFor(() => expect(next).toHaveFocus());
    await waitFor(() => expect(next).toHaveAttribute('aria-selected', 'true'));
    // Tab yang menjadi aktif tetap elemen yang sama (tidak dibuat ulang), jadi fokus bertahan.
    expect(screen.getByRole('tab', { selected: true })).toBe(next);
    expect(next).toHaveFocus();
  });
});
