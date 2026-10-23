import type { Project, ProjectInspection } from '@aios/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProblem } from '../auth/authSession';
import { copy } from '../copy';
import { TS } from '../test/fixtures';
import { api, resetApi, setWorker, workerApi } from '../test/fakeServices';
import { renderScreen } from '../test/render';
import { WorkerCallError } from '../worker/localClient';

vi.mock('../app/services', async () => (await import('../test/fakeServices')).fakeServices);
const pickFolder = vi.hoisted(() => vi.fn());
vi.mock('../lib/pickFolder', () => ({ pickFolder }));

const { ProjectsScreen } = await import('./ProjectsScreen');

const WORKER = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';
const OTHER_WORKER = '0192f0c4-7a1b-7c2d-9e3f-4a5b6c7d8e90';
const P1 = '0192f0c4-7a1b-7c2d-a001-4a5b6c7d8e91';
const P2 = '0192f0c4-7a1b-7c2d-a002-4a5b6c7d8e92';

const project = (over: Partial<Project> = {}): Project => ({
  id: P1,
  name: 'Aplikasi saya',
  workerDeviceId: WORKER,
  stack: { languages: ['typescript'], frameworks: ['react'] },
  defaultBranch: 'main',
  createdAt: TS,
  updatedAt: TS,
  ...over,
});

const inspection = (over: Partial<ProjectInspection> = {}): ProjectInspection => ({
  path: 'C:\\Kerja\\aplikasi',
  name: 'aplikasi',
  stack: { languages: ['typescript'], frameworks: ['react'], packageManager: 'pnpm' },
  git: { isRepo: true, defaultBranch: 'main', currentBranch: 'main' },
  ...over,
});

const connected = () =>
  setWorker({
    local: 'connected',
    status: { gateway: 'connected', deviceId: WORKER, activeRuns: 0, version: '0.1.0' },
  });

beforeEach(() => {
  resetApi();
  pickFolder.mockReset();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

describe('ProjectsScreen: daftar', () => {
  it('menggabungkan project server dengan folder lokal; project tanpa ikatan ditandai', async () => {
    connected();
    api.listProjects.mockResolvedValue([
      project(),
      project({ id: P2, name: 'Proyek PC lain', workerDeviceId: OTHER_WORKER }),
    ]);
    workerApi.bindings.mockResolvedValue([
      { projectId: P1, path: 'C:\\Kerja\\aplikasi', available: true },
    ]);
    await renderScreen(<ProjectsScreen />, '/projects');

    const table = await screen.findByRole('table', { name: copy.projects.listLabel });
    const mine = within(table).getByText('Aplikasi saya').closest('tr') as HTMLElement;
    expect(await within(mine).findByText('C:\\Kerja\\aplikasi')).toBeInTheDocument();
    expect(within(mine).getByText('react')).toBeInTheDocument();
    const other = within(table).getByText('Proyek PC lain').closest('tr') as HTMLElement;
    expect(within(other).getByText(copy.projects.folderMissing)).toBeInTheDocument();
  });

  it('folder hilang atau izin dicabut diberi peringatan', async () => {
    connected();
    api.listProjects.mockResolvedValue([project()]);
    workerApi.bindings.mockResolvedValue([
      { projectId: P1, path: 'C:\\Kerja\\aplikasi', available: false },
    ]);
    await renderScreen(<ProjectsScreen />, '/projects');

    expect(await screen.findByText(copy.projects.folderUnavailable)).toBeInTheDocument();
  });

  it('project milik PC ini tanpa ikatan bisa diikat ke folder', async () => {
    connected();
    api.listProjects.mockResolvedValue([project()]);
    workerApi.bind.mockResolvedValue({
      projectId: P1,
      path: 'C:\\Kerja\\aplikasi',
      available: true,
    });
    pickFolder.mockResolvedValue('C:\\Kerja\\aplikasi');
    const user = userEvent.setup();
    await renderScreen(<ProjectsScreen />, '/projects');

    await user.click(
      await screen.findByRole('button', { name: `${copy.projects.bindFolder}: Aplikasi saya` }),
    );

    expect(workerApi.bind).toHaveBeenCalledWith(P1, 'C:\\Kerja\\aplikasi');
    expect(await screen.findByText(copy.projects.bound)).toBeInTheDocument();
  });

  it('kosong: kalimat dan satu tombol aksi; tombol nonaktif bila worker belum tersambung', async () => {
    await renderScreen(<ProjectsScreen />, '/projects');

    expect(await screen.findByText(copy.projects.empty)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(copy.projects.workerOff);
    expect(screen.getByRole('button', { name: copy.projects.add })).toBeDisabled();
  });

  it('error dengan Coba lagi, dan offline', async () => {
    connected();
    api.listProjects.mockRejectedValueOnce(new ApiProblem(500, 'x', 'x'));
    const user = userEvent.setup();
    const view = await renderScreen(<ProjectsScreen />, '/projects');
    expect(await screen.findByText(copy.errors.server)).toBeInTheDocument();

    api.listProjects.mockResolvedValue([project()]);
    await user.click(screen.getByRole('button', { name: copy.states.retry }));
    expect(await screen.findByText('Aplikasi saya')).toBeInTheDocument();
    view.unmount();

    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    api.listProjects.mockRejectedValue(new ApiProblem(0, 'network', 'x'));
    await renderScreen(<ProjectsScreen />, '/projects');
    expect(await screen.findByText(copy.states.offline)).toBeInTheDocument();
  });
});

describe('AddProjectDialog', () => {
  async function openDialog() {
    const user = userEvent.setup();
    await renderScreen(<ProjectsScreen />, '/projects');
    await user.click(await screen.findByRole('button', { name: copy.projects.add }));
    const dialog = await screen.findByRole('dialog', { name: copy.projects.dialog.title });
    return { user, dialog };
  }

  it('pilih folder, periksa, daftarkan ke server, lalu ikat folder di worker', async () => {
    connected();
    api.listProjects.mockResolvedValue([project({ id: P2, name: 'Lain' })]);
    pickFolder.mockResolvedValue('C:\\Kerja\\aplikasi');
    workerApi.inspect.mockResolvedValue(inspection());
    api.createProject.mockResolvedValue(project());
    workerApi.bind.mockResolvedValue({
      projectId: P1,
      path: 'C:\\Kerja\\aplikasi',
      available: true,
    });
    const { user, dialog } = await openDialog();

    await user.click(within(dialog).getByRole('button', { name: copy.projects.dialog.pick }));

    expect(await within(dialog).findByText('C:\\Kerja\\aplikasi')).toBeInTheDocument();
    expect(within(dialog).getByLabelText(copy.projects.dialog.name)).toHaveValue('aplikasi');
    expect(within(dialog).getByLabelText(copy.projects.dialog.branch)).toHaveValue('main');
    expect(api.createProject).not.toHaveBeenCalled();

    await user.clear(within(dialog).getByLabelText(copy.projects.dialog.name));
    await user.type(within(dialog).getByLabelText(copy.projects.dialog.name), 'Aplikasi saya');
    await user.click(within(dialog).getByRole('button', { name: copy.projects.dialog.register }));

    expect(api.createProject).toHaveBeenCalledWith({
      name: 'Aplikasi saya',
      workerDeviceId: WORKER,
      stack: { languages: ['typescript'], frameworks: ['react'], packageManager: 'pnpm' },
      defaultBranch: 'main',
    });
    await waitFor(() => expect(workerApi.bind).toHaveBeenCalledWith(P1, 'C:\\Kerja\\aplikasi'));
    expect(await screen.findByText(copy.projects.dialog.registered)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('path yang dikirim ke server tidak pernah berisi folder lokal', async () => {
    connected();
    pickFolder.mockResolvedValue('C:\\Kerja\\aplikasi');
    workerApi.inspect.mockResolvedValue(inspection());
    api.createProject.mockResolvedValue(project());
    workerApi.bind.mockResolvedValue({ projectId: P1, path: 'x', available: true });
    const { user, dialog } = await openDialog();

    await user.click(within(dialog).getByRole('button', { name: copy.projects.dialog.pick }));
    await user.click(
      await within(dialog).findByRole('button', { name: copy.projects.dialog.register }),
    );

    await waitFor(() => expect(api.createProject).toHaveBeenCalled());
    expect(JSON.stringify(api.createProject.mock.calls[0])).not.toContain('Kerja');
  });

  it('folder di luar izin: pesan jelas dan tombol Izinkan folder ini, lalu diperiksa ulang', async () => {
    connected();
    pickFolder.mockResolvedValue('D:\\Lain\\app');
    workerApi.inspect
      .mockRejectedValueOnce(new WorkerCallError('path_not_allowed', 'x'))
      .mockResolvedValue(inspection({ path: 'D:\\Lain\\app', name: 'app' }));
    workerApi.addFolder.mockResolvedValue(['D:\\Lain\\app']);
    const { user, dialog } = await openDialog();

    await user.click(within(dialog).getByRole('button', { name: copy.projects.dialog.pick }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      copy.workerErrors.path_not_allowed,
    );
    await user.click(within(dialog).getByRole('button', { name: copy.projects.dialog.allow }));

    expect(workerApi.addFolder).toHaveBeenCalledWith('D:\\Lain\\app');
    expect(await within(dialog).findByLabelText(copy.projects.dialog.name)).toHaveValue('app');
  });

  it('bukan repo git: peringatan, tetap bisa didaftarkan dengan branch bawaan main', async () => {
    connected();
    pickFolder.mockResolvedValue('C:\\Kerja\\aplikasi');
    workerApi.inspect.mockResolvedValue(
      inspection({ git: { isRepo: false, defaultBranch: null, currentBranch: null } }),
    );
    const { user, dialog } = await openDialog();

    await user.click(within(dialog).getByRole('button', { name: copy.projects.dialog.pick }));

    expect(await within(dialog).findByText(copy.projects.dialog.notRepo)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(copy.projects.dialog.branch)).toHaveValue('main');
  });

  it('nama kosong ditolak lokal; kegagalan server ditampilkan dan dialog tetap terbuka', async () => {
    connected();
    pickFolder.mockResolvedValue('C:\\Kerja\\aplikasi');
    workerApi.inspect.mockResolvedValue(inspection());
    api.createProject.mockRejectedValue(new ApiProblem(400, 'invalid_worker', 'x'));
    const { user, dialog } = await openDialog();
    await user.click(within(dialog).getByRole('button', { name: copy.projects.dialog.pick }));
    const name = await within(dialog).findByLabelText(copy.projects.dialog.name);

    await user.clear(name);
    await user.click(within(dialog).getByRole('button', { name: copy.projects.dialog.register }));
    expect(within(dialog).getByText(copy.projects.dialog.emptyName)).toBeInTheDocument();
    expect(api.createProject).not.toHaveBeenCalled();

    await user.type(name, 'Nama');
    await user.click(within(dialog).getByRole('button', { name: copy.projects.dialog.register }));
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(workerApi.bind).not.toHaveBeenCalled();
  });

  it('server menerima tetapi pengikatan lokal gagal: pemberitahuan jelas, daftar disegarkan', async () => {
    connected();
    pickFolder.mockResolvedValue('C:\\Kerja\\aplikasi');
    workerApi.inspect.mockResolvedValue(inspection());
    api.createProject.mockResolvedValue(project());
    workerApi.bind.mockRejectedValue(new WorkerCallError('path_not_allowed', 'x'));
    const { user, dialog } = await openDialog();
    await user.click(within(dialog).getByRole('button', { name: copy.projects.dialog.pick }));

    await user.click(
      await within(dialog).findByRole('button', { name: copy.projects.dialog.register }),
    );

    expect(await screen.findByText(copy.projects.dialog.bindFailed)).toBeInTheDocument();
  });

  it('pemilih folder dibatalkan: tidak ada pemeriksaan', async () => {
    connected();
    pickFolder.mockResolvedValue(null);
    const { user, dialog } = await openDialog();

    await user.click(within(dialog).getByRole('button', { name: copy.projects.dialog.pick }));

    expect(workerApi.inspect).not.toHaveBeenCalled();
  });

  it('worker terputus saat dialog terbuka: tombol pilih folder dinonaktifkan', async () => {
    connected();
    const { dialog } = await openDialog();
    expect(within(dialog).getByRole('button', { name: copy.projects.dialog.pick })).toBeEnabled();

    act(() => setWorker({ local: 'reconnecting', status: null }));

    expect(within(dialog).getByRole('button', { name: copy.projects.dialog.pick })).toBeDisabled();
  });
});
