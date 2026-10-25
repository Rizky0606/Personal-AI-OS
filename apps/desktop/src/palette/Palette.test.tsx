import type { Project, Schedule, Task } from '@aios/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../copy';
import { useUiStore } from '../state/uiStore';
import { api, resetApi } from '../test/fakeServices';
import { CONV, TS, models } from '../test/fixtures';
import { renderScreen } from '../test/render';

vi.mock('../app/services', async () => (await import('../test/fakeServices')).fakeServices);

const { CommandPalette } = await import('../shell/CommandPalette');

const PROJECT = '0192f0c4-7a1b-7c2d-a001-4a5b6c7d8e91';
const SCHEDULE = '0192f0c4-7a1b-7c2d-a002-4a5b6c7d8e92';

const project: Project = {
  id: PROJECT,
  name: 'Toko Online',
  workerDeviceId: '0192f0c4-7a1b-7c2d-a003-4a5b6c7d8e93',
  stack: { languages: [], frameworks: [] },
  defaultBranch: 'main',
  createdAt: TS,
  updatedAt: TS,
};
const task: Task = {
  id: '0192f0c4-7a1b-7c2d-a004-4a5b6c7d8e94',
  projectId: PROJECT,
  title: 'Tambah keranjang belanja',
  body: '',
  status: 'todo',
  position: 0,
  agentRole: null,
  runId: null,
  branch: null,
  diffStat: null,
  createdAt: TS,
  updatedAt: TS,
};
const schedule: Schedule = {
  id: SCHEDULE,
  name: 'Berita AI mingguan',
  cron: '0 7 * * 1',
  timezone: 'Asia/Jakarta',
  prompt: 'Ringkas',
  target: 'chat',
  agentRole: null,
  enabled: true,
  notify: 'always',
  nextRunAt: null,
  conversationId: null,
  createdAt: TS,
  updatedAt: TS,
};
const conversation = {
  id: CONV,
  title: 'Rencana rilis versi 2',
  surface: 'windows' as const,
  projectId: null,
  spaceId: null,
  pinned: false,
  archivedAt: null,
  createdAt: TS,
  updatedAt: TS,
};

beforeEach(() => {
  resetApi();
  useUiStore.setState(useUiStore.getInitialState(), true);
  useUiStore.setState({ paletteOpen: true, activeProjectId: PROJECT });
  api.listProjects.mockResolvedValue([project]);
  api.listModels.mockResolvedValue(models);
  api.listTasks.mockResolvedValue([task]);
  api.listSchedules.mockResolvedValue([schedule]);
  api.listConversations.mockResolvedValue({ items: [conversation], nextBefore: null });
});

const input = () => screen.findByRole('combobox', { name: copy.palette.input });
/** Nama opsi memuat hint (mis. Ctrl+N), jadi dicocokkan dari awal label. */
const option = (name: string | RegExp) =>
  screen.findByRole('option', {
    name: typeof name === 'string' ? (accessible) => accessible.startsWith(name) : name,
  });

describe('Palet perintah', () => {
  it('terbuka dengan fokus di kolom cari; tanpa query hanya perintah dan navigasi', async () => {
    await renderScreen(<CommandPalette />);

    expect(await input()).toHaveFocus();
    expect(await option(copy.palette.newChat)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: new RegExp(copy.nav.kanban) })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Rencana rilis/ })).toBeNull();
  });

  it('mencari percakapan, kartu, jadwal, dan project; Enter membuka yang pertama', async () => {
    const user = userEvent.setup();
    const { router } = await renderScreen(<CommandPalette />);
    await input();

    await user.keyboard('rilis');
    expect(await option('Rencana rilis versi 2')).toBeInTheDocument();
    await user.keyboard('{Enter}');

    await waitFor(() => expect(router.state.location.pathname).toBe(`/chat/${CONV}`));
    expect(useUiStore.getState().paletteOpen).toBe(false);
  });

  it('kartu project aktif ditemukan dan membuka Kanban; jadwal membuka detailnya', async () => {
    const user = userEvent.setup();
    const { router } = await renderScreen(<CommandPalette />);
    await input();

    await user.keyboard('keranjang');
    const card = await option(/Tambah keranjang belanja/);
    expect(
      within(card).getByText(copy.palette.taskIn(copy.kanban.columns.todo)),
    ).toBeInTheDocument();
    await user.click(card);
    await waitFor(() => expect(router.state.location.pathname).toBe('/kanban'));
  });

  it('jadwal: membuka layar detail jadwal', async () => {
    const user = userEvent.setup();
    const { router } = await renderScreen(<CommandPalette />);
    await input();

    await user.keyboard('berita');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(router.state.location.pathname).toBe(`/schedules/${SCHEDULE}`));
  });

  it('navigasi keyboard: panah bawah/atas berputar, Home/End melompat, aria-activedescendant mengikuti', async () => {
    const user = userEvent.setup();
    await renderScreen(<CommandPalette />);
    const field = await input();
    const options = await screen.findAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(field).toHaveAttribute('aria-activedescendant', options[0]?.id);

    await user.keyboard('{ArrowDown}');
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowUp}{ArrowUp}');
    const all = screen.getAllByRole('option');
    expect(all.at(-1)).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Home}');
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{End}');
    expect(screen.getAllByRole('option').at(-1)).toHaveAttribute('aria-selected', 'true');
  });

  it('tidak ada yang cocok: pesan kosong dan Enter tidak melakukan apa pun', async () => {
    const user = userEvent.setup();
    const { router } = await renderScreen(<CommandPalette />);
    await input();

    await user.keyboard('zzzzqq{Enter}');

    expect(await screen.findByText(copy.palette.empty)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    expect(useUiStore.getState().paletteOpen).toBe(true);
  });

  it('Esc menutup; dibuka lagi mulai dari kosong', async () => {
    const user = userEvent.setup();
    await renderScreen(<CommandPalette />);
    await input();
    await user.keyboard('abc');

    await user.keyboard('{Escape}');
    await waitFor(() => expect(useUiStore.getState().paletteOpen).toBe(false));
    act(() => useUiStore.getState().setPaletteOpen(true));

    expect(await input()).toHaveValue('');
  });
});

describe('Palet perintah: aksi', () => {
  it('ganti tema dan ganti model mengubah state tersimpan; model otomatis mengembalikan null', async () => {
    const user = userEvent.setup();
    await renderScreen(<CommandPalette />);
    await input();

    await user.keyboard('gelap');
    await user.click(await option(copy.palette.themeTo(copy.settings.themeDark)));
    expect(useUiStore.getState().theme).toBe('dark');

    act(() => useUiStore.getState().setPaletteOpen(true));
    await input();
    await user.keyboard('cepat');
    await user.click(await option(copy.palette.useModel('Cepat')));
    expect(useUiStore.getState().model).toBe('combo/fast');

    act(() => useUiStore.getState().setPaletteOpen(true));
    await input();
    await user.keyboard('otomatis');
    await user.click(await option(copy.palette.autoModel));
    expect(useUiStore.getState().model).toBeNull();
  });

  it('pindah project dan chat umum; buka panel Terminal; chat baru menaikkan sinyal', async () => {
    const user = userEvent.setup();
    useUiStore.setState({ activeProjectId: null });
    await renderScreen(<CommandPalette />);
    await input();

    await user.keyboard('toko');
    await user.click(await option(copy.palette.switchProject('Toko Online')));
    expect(useUiStore.getState().activeProjectId).toBe(PROJECT);

    act(() => useUiStore.getState().setPaletteOpen(true));
    await input();
    await user.keyboard('terminal');
    await user.click(await option(copy.palette.openPanel(copy.shell.panels.terminal)));
    expect(useUiStore.getState()).toMatchObject({
      rightPanelOpen: true,
      rightPanelTab: 'terminal',
    });

    act(() => useUiStore.getState().setPaletteOpen(true));
    await input();
    const before = useUiStore.getState().newChatSignal;
    await user.keyboard('chat baru{Enter}');
    expect(useUiStore.getState().newChatSignal).toBe(before + 1);

    act(() => useUiStore.getState().setPaletteOpen(true));
    await input();
    await user.keyboard('umum');
    await user.click(await option(copy.palette.generalChat));
    expect(useUiStore.getState().activeProjectId).toBeNull();
  });

  it('buka Kuota dan Pembanding model dari palet', async () => {
    const user = userEvent.setup();
    const { router } = await renderScreen(<CommandPalette />);
    await input();

    await user.keyboard('kuota{Enter}');
    await waitFor(() => expect(router.state.location.pathname).toBe('/quota'));

    act(() => useUiStore.getState().setPaletteOpen(true));
    await input();
    await user.keyboard('banding{Enter}');
    await waitFor(() => expect(router.state.location.pathname).toBe('/compare'));
  });
});
