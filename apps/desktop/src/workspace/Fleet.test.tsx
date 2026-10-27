import type { Project } from '@aios/contracts';
import { MAX_FLEET_TASKS } from '@aios/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProblem } from '../auth/authSession';
import { copy } from '../copy';
import { useUiStore } from '../state/uiStore';
import { CONV, RUN_1, RUN_2, TS, run } from '../test/fixtures';
import { api, resetApi } from '../test/fakeServices';
import { renderScreen } from '../test/render';
import type { WorkspaceRun } from './runs';

vi.mock('../app/services', async () => (await import('../test/fakeServices')).fakeServices);

const { WorkspaceScreen } = await import('./WorkspaceScreen');

const P1 = '0192f0c4-7a1b-7c2d-a001-4a5b6c7d8e91';
const P2 = '0192f0c4-7a1b-7c2d-a002-4a5b6c7d8e92';
const WORKER = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';

const project = (id: string, name: string): Project => ({
  id,
  name,
  workerDeviceId: WORKER,
  stack: { languages: ['typescript'], frameworks: [] },
  defaultBranch: 'main',
  instructions: '',
  createdAt: TS,
  updatedAt: TS,
});

const entry = (over: Partial<WorkspaceRun['run']>, title: string): WorkspaceRun => ({
  run: run({ kind: 'coding', engine: 'omp', ...over }),
  title,
  projectId: P1,
  projectName: 'Toko Online',
});

const launched = (n: number, failed = 0) => ({
  items: Array.from({ length: n }, (_, i) => ({
    conversationId: CONV,
    title: `Tugas ${i + 1}`,
    run: run({ id: RUN_1 }),
  })),
  failed,
});

beforeEach(() => {
  resetApi();
  useUiStore.setState(useUiStore.getInitialState(), true);
  api.listProjects.mockResolvedValue([project(P1, 'Toko Online'), project(P2, 'Blog')]);
  api.listRuns.mockResolvedValue([]);
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

async function openFleet() {
  const user = userEvent.setup();
  await renderScreen(<WorkspaceScreen />, '/workspace');
  await user.click(await screen.findByRole('button', { name: copy.fleet.open }));
  const dialog = await screen.findByRole('dialog', { name: copy.fleet.title });
  return { user, dialog };
}

describe('armada agent', () => {
  it('beberapa tugas dikirim sekaligus ke project terpilih; berhasil memberi kabar dan menutup dialog', async () => {
    api.launchFleet.mockResolvedValue(launched(2));
    const { user, dialog } = await openFleet();

    await user.type(
      within(dialog).getByRole('textbox', { name: copy.fleet.task(1) }),
      'Tambahkan dark mode',
    );
    await user.click(within(dialog).getByRole('button', { name: copy.fleet.addTask }));
    await user.type(
      within(dialog).getByRole('textbox', { name: copy.fleet.task(2) }),
      'Perbaiki validasi email',
    );
    await user.click(within(dialog).getByRole('switch', { name: copy.fleet.planOnly }));
    await user.click(within(dialog).getByRole('button', { name: copy.fleet.launch(2) }));

    expect(api.launchFleet).toHaveBeenCalledWith({
      projectId: P1,
      tasks: [{ prompt: 'Tambahkan dark mode' }, { prompt: 'Perbaiki validasi email' }],
      planOnly: true,
      model: undefined,
    });
    expect(await screen.findByText(copy.fleet.launched(2, 0))).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('project bisa dipilih; project yang sedang dibuka menjadi pilihan awal', async () => {
    useUiStore.setState({ activeProjectId: P2 });
    api.launchFleet.mockResolvedValue(launched(1));
    const { user, dialog } = await openFleet();

    expect(
      within(dialog).getByRole('button', { name: `${copy.fleet.project}: Blog` }),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: `${copy.fleet.project}: Blog` }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'Toko Online' }));
    await user.type(
      within(dialog).getByRole('textbox', { name: copy.fleet.task(1) }),
      'Satu tugas',
    );
    await user.click(within(dialog).getByRole('button', { name: copy.fleet.launch(1) }));

    expect(api.launchFleet).toHaveBeenCalledWith(expect.objectContaining({ projectId: P1 }));
  });

  it(`tugas dibatasi ${MAX_FLEET_TASKS}; tugas bisa dihapus; tanpa isi tombol jalankan nonaktif`, async () => {
    const { user, dialog } = await openFleet();
    const launch = within(dialog).getByRole('button', { name: copy.fleet.launch(1) });
    expect(launch).toBeDisabled();

    for (let i = 1; i < MAX_FLEET_TASKS; i++) {
      await user.click(within(dialog).getByRole('button', { name: copy.fleet.addTask }));
    }
    expect(within(dialog).getAllByRole('textbox')).toHaveLength(MAX_FLEET_TASKS);
    expect(
      within(dialog).queryByRole('button', { name: copy.fleet.addTask }),
    ).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: copy.fleet.removeTask(4) }));
    expect(within(dialog).getAllByRole('textbox')).toHaveLength(MAX_FLEET_TASKS - 1);
    expect(within(dialog).getByRole('button', { name: copy.fleet.addTask })).toBeInTheDocument();
  });

  it('batas agent per project (409) tampil sebagai pesan dan dialog tetap terbuka dengan isinya', async () => {
    api.launchFleet.mockRejectedValue(
      new ApiProblem(
        409,
        'fleet_busy',
        'Project ini sudah punya 3 agent yang berjalan; batasnya 4.',
      ),
    );
    const { user, dialog } = await openFleet();
    const box = within(dialog).getByRole('textbox', { name: copy.fleet.task(1) });
    await user.type(box, 'Tugas yang ditolak');
    await user.click(within(dialog).getByRole('button', { name: copy.fleet.launch(1) }));

    expect(await within(dialog).findByText(/sudah punya 3 agent/)).toBeInTheDocument();
    expect(box).toHaveValue('Tugas yang ditolak');
  });

  it('sebagian gagal dimulai: kabar menyebut jumlah yang gagal', async () => {
    api.launchFleet.mockResolvedValue(launched(2, 1));
    const { user, dialog } = await openFleet();
    await user.type(within(dialog).getByRole('textbox', { name: copy.fleet.task(1) }), 'a');
    await user.click(within(dialog).getByRole('button', { name: copy.fleet.launch(1) }));
    expect(await screen.findByText(copy.fleet.launched(2, 1))).toBeInTheDocument();
  });
});

describe('Hentikan semua', () => {
  it('muncul bila lebih dari satu run berjalan dan menghentikan semuanya, bukan yang menunggu tinjauan', async () => {
    api.listRuns.mockResolvedValue([
      entry({ id: RUN_1, status: 'running' }, 'Satu'),
      entry({ id: RUN_2, status: 'waiting_approval' }, 'Dua'),
      entry({ id: '0192f0c4-7a1b-7c2d-a003-4a5b6c7d8e93', status: 'needs_review' }, 'Tiga'),
    ]);
    api.cancelRun.mockResolvedValue(run({ status: 'cancelled' }));
    const user = userEvent.setup();
    await renderScreen(<WorkspaceScreen />, '/workspace');

    await user.click(await screen.findByRole('button', { name: copy.fleet.stopAll }));
    await waitFor(() => expect(api.cancelRun).toHaveBeenCalledTimes(2));
    expect(api.cancelRun).toHaveBeenCalledWith(RUN_1);
    expect(api.cancelRun).toHaveBeenCalledWith(RUN_2);
    expect(await screen.findByText(copy.fleet.stopAllDone(2))).toBeInTheDocument();
  });

  it('tidak tampil bila hanya satu run yang berjalan', async () => {
    api.listRuns.mockResolvedValue([entry({ id: RUN_1, status: 'running' }, 'Satu')]);
    await renderScreen(<WorkspaceScreen />, '/workspace');
    await screen.findByText('Satu');
    expect(screen.queryByRole('button', { name: copy.fleet.stopAll })).not.toBeInTheDocument();
  });
});
