import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../copy';
import { PageHeader } from '../screens/PageLayout';
import { PageHeader as UiPageHeader } from '../ui/PageHeader';
import { RIGHT_PANEL_DEFAULT, useUiStore } from '../state/uiStore';
import { resetApi } from '../test/fakeServices';
import { TooltipProvider } from '../ui/Tooltip';

vi.mock('../app/services', async () => (await import('../test/fakeServices')).fakeServices);

const { Shell } = await import('./Shell');

async function renderShell(path = '/', screens: Record<string, () => ReactNode> = {}) {
  const root = createRootRoute({ component: Shell });
  const paths = ['/', '/projects', '/kanban', '/schedules', '/research', '/settings'];
  const router = createRouter({
    routeTree: root.addChildren(
      paths.map((p) =>
        createRoute({
          getParentRoute: () => root,
          path: p,
          component: screens[p] ?? (() => <p>isi {p}</p>),
        }),
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
  it('kerangka: satu sidebar, topbar di area utama; Pengaturan terpisah dan panel kanan tertutup', async () => {
    await renderShell();

    const sidebar = screen.getByRole('complementary', { name: copy.shell.sidebar });
    const nav = within(sidebar).getByRole('navigation', { name: copy.shell.navigation });
    expect(within(nav).getAllByRole('link')).toHaveLength(6);
    expect(within(sidebar).getByRole('link', { name: copy.nav.settings })).toBeInTheDocument();
    expect(screen.getByRole('main', { name: copy.shell.mainArea })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: copy.nav.chat })).toBeInTheDocument();
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument();
    expect(within(sidebar).getByText(copy.status.idle)).toBeInTheDocument();
    expect(
      screen.queryByRole('complementary', { name: copy.shell.toggleRightPanel }),
    ).not.toBeInTheDocument();
  });

  it('tiga pulau di atas kanvas bg: sidebar dan area utama berupa pulau, jarak ke tepi dan antar pulau dari token', async () => {
    const { container } = await renderShell();
    ctrl('j');
    const sidebar = screen.getByRole('complementary', { name: copy.shell.sidebar });
    const main = screen.getByRole('main', { name: copy.shell.mainArea });
    const panel = screen.getByRole('complementary', { name: copy.shell.toggleRightPanel });

    for (const island of [sidebar, main, panel]) {
      expect(island).toHaveClass('rounded-panel', 'border', 'bg-surface-1', 'shadow-layer-1');
    }
    // Kanvas: warna bg, padding dan gap dari --aios-island-gap, dan tidak ada pulau yang menempel tepi.
    const canvas = container.querySelector('[data-shell-canvas]');
    expect(canvas).toHaveClass('bg-bg', 'p-(--aios-island-gap)', 'gap-(--aios-island-gap)');
    expect(canvas).toContainElement(sidebar);
    expect(canvas).toContainElement(main);
    expect(canvas).toContainElement(panel);
  });

  it('Topbar dipakai Shell di DALAM pulau utama: judul h1, koneksi, dan tombol panel kanan', async () => {
    await renderShell();
    const main = screen.getByRole('main', { name: copy.shell.mainArea });

    expect(within(main).getByRole('heading', { level: 1, name: copy.nav.chat })).toBeVisible();
    expect(within(main).getByRole('status')).toHaveAttribute('data-connection');
    const toggle = within(main).getByRole('button', { name: copy.shell.toggleRightPanel });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);
    expect(useUiStore.getState().rightPanelOpen).toBe(true);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    // Header lama tidak ada: hanya satu h1 dan satu banner/pita judul di halaman.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('urutan fokus mengikuti urutan visual: sidebar, area utama, lalu panel kanan', async () => {
    await renderShell();
    ctrl('j');
    const sidebar = screen.getByRole('complementary', { name: copy.shell.sidebar });
    const main = screen.getByRole('main', { name: copy.shell.mainArea });
    const panel = screen.getByRole('complementary', { name: copy.shell.toggleRightPanel });
    const follows = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

    expect(follows(sidebar, main)).toBe(true);
    expect(follows(main, panel)).toBe(true);
    // Di dalam sidebar: navigasi dulu, lalu daftar konteks; Pengaturan di kaki.
    const nav = within(sidebar).getByRole('navigation', { name: copy.shell.navigation });
    const settings = within(sidebar).getByRole('link', { name: copy.nav.settings });
    expect(follows(nav, settings)).toBe(true);
  });

  it('aria-current="page" hanya pada item navigasi yang aktif dan berpindah mengikuti rute', async () => {
    const { router } = await renderShell('/research');
    const nav = screen.getByRole('navigation', { name: copy.shell.navigation });

    expect(within(nav).getByRole('link', { name: copy.nav.research })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: copy.nav.chat })).not.toHaveAttribute(
      'aria-current',
    );
    expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1);

    ctrl('3');
    await waitFor(() => expect(router.state.location.pathname).toBe('/kanban'));
    expect(within(nav).getByRole('link', { name: copy.nav.kanban })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: copy.nav.research })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('satu judul per layar: PageHeader layar mengisi h1 Topbar, tidak ada h2 kembar', async () => {
    await renderShell('/kanban', {
      '/kanban': () => <PageHeader title="Toko Online" description="Papan tugas project." />,
    });
    const main = screen.getByRole('main', { name: copy.shell.mainArea });

    expect(
      await within(main).findByRole('heading', { level: 1, name: 'Toko Online' }),
    ).toBeInTheDocument();
    expect(within(main).getAllByRole('heading')).toHaveLength(1);
    expect(within(main).queryByRole('heading', { name: copy.nav.kanban })).not.toBeInTheDocument();
    expect(within(main).getByText('Papan tugas project.')).toBeInTheDocument();
  });

  it('satu judul per layar: Pengaturan (ui/PageHeader) tidak menampilkan "Pengaturan" dua kali', async () => {
    await renderShell('/settings', {
      '/settings': () => <UiPageHeader title={copy.nav.settings} />,
    });
    const main = screen.getByRole('main', { name: copy.shell.mainArea });

    await within(main).findByRole('heading', { level: 1, name: copy.nav.settings });
    expect(within(main).getAllByText(copy.nav.settings)).toHaveLength(1);
  });

  it('judul kembali ke nama bagian saat pindah ke layar yang tidak punya PageHeader', async () => {
    const { router } = await renderShell('/kanban', {
      '/kanban': () => <PageHeader title="Toko Online" />,
    });
    await screen.findByRole('heading', { level: 1, name: 'Toko Online' });

    ctrl('4');
    await waitFor(() => expect(router.state.location.pathname).toBe('/schedules'));
    expect(
      await screen.findByRole('heading', { level: 1, name: copy.nav.schedules }),
    ).toBeInTheDocument();
  });

  it('Ctrl+B menciutkan sidebar jadi ikon dan membukanya lagi; tombol buka ada di sidebar ringkas', async () => {
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

    fireEvent.click(within(sidebar).getByRole('button', { name: copy.shell.expandSidebar }));
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

  it('panel kanan membuka dengan animasi lebar, menutup menyempit dulu (inert) lalu dilepas setelah 240 ms', async () => {
    await renderShell();
    const panel = () => screen.queryByRole('complementary', { name: copy.shell.toggleRightPanel });

    ctrl('j');
    // Animasi lebar ada di slot pemotong (bersama jarak pulau), bukan di isi panel.
    expect(panel()?.parentElement).toHaveClass('aios-panel-open');
    expect(panel()).not.toHaveAttribute('inert');
    // Isi sidebar dan area utama tidak dipasang ulang saat panel membuka.
    expect(screen.getByRole('main', { name: copy.shell.mainArea })).toBeInTheDocument();

    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      ctrl('j');
      expect(panel()?.parentElement).toHaveClass('aios-panel-close');
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
      expect(panel.parentElement).toHaveClass('aios-panel-open');
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
