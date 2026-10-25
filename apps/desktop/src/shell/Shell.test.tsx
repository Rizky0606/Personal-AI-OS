import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
      ['2', '/projects'],
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
