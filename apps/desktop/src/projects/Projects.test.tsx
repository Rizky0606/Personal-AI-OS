import type { Project, ProjectInspection } from '@aios/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProblem } from '../auth/authSession';
import { copy } from '../copy';
import { TS, run } from '../test/fixtures';
import { api, resetApi, setWorker, workerApi } from '../test/fakeServices';
import { renderScreen } from '../test/render';
import { useUiStore } from '../state/uiStore';
import type { WorkspaceRun } from '../workspace/runs';
import { WorkerCallError } from '../worker/localClient';

vi.mock('../app/services', async () => (await import('../test/fakeServices')).fakeServices);
const pickFolder = vi.hoisted(() => vi.fn());
vi.mock('../lib/pickFolder', () => ({ pickFolder }));

const { ProjectsScreen } = await import('./ProjectsScreen');
const { ProjectList } = await import('./ProjectList');

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
  instructions: '',
  createdAt: TS,
  updatedAt: TS,
  ...over,
});

const inspection = (over: Partial<ProjectInspection> = {}): ProjectInspection => ({
  path: 'C:\\Kerja\\aplikasi',
  name: 'aplikasi',
  stack: { languages: ['typescript'], frameworks: ['react'], packageManager: 'pnpm' },
  git: { isRepo: true, defaultBranch: 'main', currentBranch: 'main', branches: ['main', 'prod'] },
  ...over,
});

const connected = () =>
  setWorker({
    local: 'connected',
    status: {
      gateway: 'connected',
      deviceId: WORKER,
      activeRuns: 0,
      version: '0.1.0',
      ompVersion: null,
      browserAvailable: false,
    },
  });

beforeEach(() => {
  resetApi();
  pickFolder.mockReset();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

/** Buka menu aksi baris project lalu pilih satu item (aksi sekunder tidak lagi tampil sebagai tombol di baris). */
async function chooseAction(user: UserEvent, list: HTMLElement, projectName: string, item: string) {
  await user.click(within(list).getByRole('button', { name: copy.projects.rowMenu(projectName) }));
  await user.click(await screen.findByRole('menuitem', { name: item }));
}

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

    const list = await screen.findByRole('list', { name: copy.projects.listLabel });
    const mine = within(list).getByText('Aplikasi saya').closest('li') as HTMLElement;
    expect(await within(mine).findByText('C:\\Kerja\\aplikasi')).toBeInTheDocument();
    expect(within(mine).getByText('react')).toBeInTheDocument();
    const other = within(list).getByText('Proyek PC lain').closest('li') as HTMLElement;
    expect(within(other).getByText(copy.projects.folderMissing)).toBeInTheDocument();
  });

  it('aturan project: ringkasan di tabel, dialog mengubah dan menyimpan ke server', async () => {
    connected();
    const user = userEvent.setup();
    api.listProjects.mockResolvedValue([project({ instructions: 'Pakai pnpm.' })]);
    workerApi.bindings.mockResolvedValue([]);
    api.updateProject.mockResolvedValue(project({ instructions: 'Pakai pnpm.\nJalankan tes.' }));
    await renderScreen(<ProjectsScreen />, '/projects');

    const list = await screen.findByRole('list', { name: copy.projects.listLabel });
    expect(within(list).getByText('Pakai pnpm.')).toBeInTheDocument();
    await chooseAction(user, list, 'Aplikasi saya', copy.projects.rules.edit);
    const dialog = await screen.findByRole('dialog', {
      name: copy.projects.rules.title('Aplikasi saya'),
    });
    const field = within(dialog).getByRole('textbox', { name: copy.projects.rules.label });
    expect(field).toHaveValue('Pakai pnpm.');
    await user.type(field, '{Enter}Jalankan tes.  ');
    await user.click(within(dialog).getByRole('button', { name: copy.projects.rules.save }));

    expect(api.updateProject).toHaveBeenCalledWith(P1, {
      instructions: 'Pakai pnpm.\nJalankan tes.',
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText(copy.projects.rules.saved)).toBeInTheDocument();
  });

  it('setup worktree: dialog memuat setelan dari worker, menolak karakter shell, dan menyimpannya', async () => {
    connected();
    const user = userEvent.setup();
    api.listProjects.mockResolvedValue([project()]);
    workerApi.bindings.mockResolvedValue([]);
    workerApi.setupGet.mockResolvedValue({
      commands: ['pnpm install'],
      linkNodeModules: false,
      lsp: true,
    });
    workerApi.setupSet.mockImplementation((_id, setup) => Promise.resolve(setup));
    await renderScreen(<ProjectsScreen />, '/projects');

    const list = await screen.findByRole('list', { name: copy.projects.listLabel });
    await chooseAction(user, list, 'Aplikasi saya', copy.projects.setup.edit);
    const dialog = await screen.findByRole('dialog', {
      name: copy.projects.setup.title('Aplikasi saya'),
    });
    const field = within(dialog).getByRole('textbox', { name: copy.projects.setup.commandsLabel });
    await waitFor(() => expect(field).toHaveValue('pnpm install'));

    await user.type(field, '{Enter}pnpm test && rm -rf x');
    expect(within(dialog).getByText(copy.projects.setup.invalid(2))).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: copy.projects.setup.save })).toBeDisabled();

    await user.clear(field);
    await user.type(field, 'pnpm install --offline');
    await user.click(within(dialog).getByRole('switch', { name: copy.projects.setup.link }));
    await user.click(within(dialog).getByRole('switch', { name: copy.projects.setup.lsp }));
    await user.click(within(dialog).getByRole('button', { name: copy.projects.setup.save }));

    expect(workerApi.setupSet).toHaveBeenCalledWith(P1, {
      commands: ['pnpm install --offline'],
      linkNodeModules: true,
      lsp: false,
    });
    expect(await screen.findByText(copy.projects.setup.saved)).toBeInTheDocument();
  });

  it('ganti branch: branch lokal dari worker dipilih lalu disimpan ke server', async () => {
    connected();
    const user = userEvent.setup();
    api.listProjects.mockResolvedValue([project({ defaultBranch: 'prod' })]);
    workerApi.bindings.mockResolvedValue([
      { projectId: P1, path: 'C:\\Kerja\\aplikasi', available: true },
    ]);
    workerApi.inspect.mockResolvedValue(
      inspection({
        git: {
          isRepo: true,
          defaultBranch: 'main',
          currentBranch: 'main',
          branches: ['main', 'prod'],
        },
      }),
    );
    api.updateProject.mockResolvedValue(project({ defaultBranch: 'main' }));
    await renderScreen(<ProjectsScreen />, '/projects');

    const list = await screen.findByRole('list', { name: copy.projects.listLabel });
    await within(list).findByText('C:\\Kerja\\aplikasi');
    await chooseAction(user, list, 'Aplikasi saya', copy.projects.menu.branch);
    const dialog = await screen.findByRole('dialog', {
      name: copy.projects.branch.title('Aplikasi saya'),
    });
    expect(workerApi.inspect).toHaveBeenCalledWith('C:\\Kerja\\aplikasi');
    const local = await within(dialog).findByRole('group', {
      name: copy.projects.branch.localBranches,
    });
    await user.click(within(local).getByRole('button', { name: 'main' }));
    await user.click(within(dialog).getByRole('button', { name: copy.projects.branch.save }));
    expect(api.updateProject).toHaveBeenCalledWith(P1, { defaultBranch: 'main' });
    expect(await screen.findByText(copy.projects.branch.saved('main'))).toBeInTheDocument();
  });

  it('lepas folder dengan konfirmasi; berkas tidak disentuh (hanya ikatan worker)', async () => {
    connected();
    const user = userEvent.setup();
    api.listProjects.mockResolvedValue([project()]);
    workerApi.bindings.mockResolvedValue([
      { projectId: P1, path: 'C:\\Kerja\\aplikasi', available: true },
    ]);
    workerApi.unbind.mockResolvedValue([]);
    await renderScreen(<ProjectsScreen />, '/projects');

    const list = await screen.findByRole('list', { name: copy.projects.listLabel });
    await within(list).findByText('C:\\Kerja\\aplikasi');
    await chooseAction(user, list, 'Aplikasi saya', copy.projects.unbind.action);
    const dialog = await screen.findByRole('dialog', { name: copy.projects.unbind.title });
    await user.click(within(dialog).getByRole('button', { name: copy.projects.unbind.action }));
    await waitFor(() => expect(workerApi.unbind).toHaveBeenCalledWith(P1));
    expect(await screen.findByText(copy.projects.unbind.done)).toBeInTheDocument();
  });

  it('hapus project: konfirmasi, hapus di server, lalu ikatan folder lokal ikut dilepas', async () => {
    connected();
    const user = userEvent.setup();
    api.listProjects.mockResolvedValue([project()]);
    workerApi.bindings.mockResolvedValue([
      { projectId: P1, path: 'C:\\Kerja\\aplikasi', available: true },
    ]);
    api.deleteProject.mockResolvedValue(undefined);
    workerApi.unbind.mockResolvedValue([]);
    await renderScreen(<ProjectsScreen />, '/projects');

    const list = await screen.findByRole('list', { name: copy.projects.listLabel });
    await within(list).findByText('C:\\Kerja\\aplikasi');
    await chooseAction(user, list, 'Aplikasi saya', copy.projects.remove.action);
    const dialog = await screen.findByRole('dialog', { name: copy.projects.remove.title });
    await user.click(within(dialog).getByRole('button', { name: copy.projects.remove.action }));
    await waitFor(() => expect(api.deleteProject).toHaveBeenCalledWith(P1));
    await waitFor(() => expect(workerApi.unbind).toHaveBeenCalledWith(P1));
    expect(await screen.findByText(copy.projects.remove.done)).toBeInTheDocument();
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

  it('daftar ringkas kosong: tombol Tambah project membuka dialog tambah project', async () => {
    connected();
    const user = userEvent.setup();
    await renderScreen(<ProjectList />, '/projects');

    await user.click(await screen.findByRole('button', { name: copy.projects.add }));

    expect(
      await screen.findByRole('dialog', { name: copy.projects.dialog.title }),
    ).toBeInTheDocument();
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

describe('ProjectsScreen: ringkasan dan akses cepat (sesi 6)', () => {
  const runOf = (
    projectId: string,
    status: 'running' | 'completed',
    title: string,
    updatedAt: string,
  ): WorkspaceRun => ({
    run: run({ kind: 'coding', engine: 'omp', status, updatedAt }),
    title,
    projectId,
    projectName: 'Aplikasi saya',
  });

  it('kolom aktivitas terakhir: judul run terbaru dan statusnya; project tanpa run diberi tanda kosong', async () => {
    connected();
    api.listProjects.mockResolvedValue([project(), project({ id: P2, name: 'Proyek baru' })]);
    api.listRuns.mockResolvedValue([
      runOf(P1, 'completed', 'Perbaiki login', '2026-10-22T09:00:00Z'),
      runOf(P1, 'running', 'Tambah dark mode', '2026-10-22T08:00:00Z'),
    ]);
    await renderScreen(<ProjectsScreen />, '/projects');

    const table = await screen.findByRole('table', { name: copy.projects.listLabel });
    const first = within(table).getByText('Aplikasi saya').closest('tr') as HTMLElement;
    expect(await within(first).findByText('Perbaiki login')).toBeInTheDocument();
    expect(within(first).getByText(copy.runStatus.completed)).toBeInTheDocument();
    const second = within(table).getByText('Proyek baru').closest('tr') as HTMLElement;
    expect(within(second).getByText(copy.projects.noActivity)).toBeInTheDocument();
  });

  it('Buka chat: memilih project aktif dan membuka percakapan project', async () => {
    connected();
    const user = userEvent.setup();
    api.listProjects.mockResolvedValue([project()]);
    const { router } = await renderScreen(<ProjectsScreen />, '/projects');

    await user.click(
      await screen.findByRole('button', { name: `${copy.projects.openChat}: Aplikasi saya` }),
    );

    expect(useUiStore.getState().activeProjectId).toBe(P1);
    expect(router.state.location.pathname).toBe(`/workspace/${P1}`);
  });

  it('daftar ringkas: project aktif ditandai pelat, klik memilihnya dan membuka chat project', async () => {
    connected();
    const user = userEvent.setup();
    api.listProjects.mockResolvedValue([project(), project({ id: P2, name: 'Proyek lain' })]);
    useUiStore.setState({ activeProjectId: P2 });
    const { router, container } = await renderScreen(<ProjectList />, '/projects');

    await screen.findByText('Aplikasi saya');
    expect(container.querySelector('[data-plate="active"]')).toHaveAttribute('data-visible', 'true');
    await user.click(screen.getByRole('button', { name: /Aplikasi saya/ }));
    expect(useUiStore.getState().activeProjectId).toBe(P1);
    expect(router.state.location.pathname).toBe(`/workspace/${P1}`);
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
    expect(
      within(dialog).getByRole('button', { name: `${copy.projects.dialog.branch}: main` }),
    ).toBeInTheDocument();
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

  it('branch bawaan dipilih dari branch lokal folder, bukan diketik', async () => {
    connected();
    pickFolder.mockResolvedValue('C:\\Kerja\\aplikasi');
    workerApi.inspect.mockResolvedValue(inspection());
    api.createProject.mockResolvedValue(project());
    workerApi.bind.mockResolvedValue({ projectId: P1, path: 'x', available: true });
    const { user, dialog } = await openDialog();

    await user.click(within(dialog).getByRole('button', { name: copy.projects.dialog.pick }));
    await user.click(
      await within(dialog).findByRole('button', { name: `${copy.projects.dialog.branch}: main` }),
    );
    await user.click(await screen.findByRole('menuitemradio', { name: 'prod' }));
    expect(
      within(dialog).queryByRole('textbox', { name: copy.projects.dialog.branch }),
    ).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: copy.projects.dialog.register }));

    expect(api.createProject).toHaveBeenCalledWith(
      expect.objectContaining({ defaultBranch: 'prod' }),
    );
  });

  it('folder bukan repo git: branch bawaan tetap bisa diketik', async () => {
    connected();
    pickFolder.mockResolvedValue('C:\\Kerja\\aplikasi');
    workerApi.inspect.mockResolvedValue(
      inspection({
        git: { isRepo: false, defaultBranch: null, currentBranch: null, branches: [] },
      }),
    );
    const { user, dialog } = await openDialog();

    await user.click(within(dialog).getByRole('button', { name: copy.projects.dialog.pick }));
    expect(await within(dialog).findByLabelText(copy.projects.dialog.branch)).toHaveValue('main');
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
      inspection({
        git: { isRepo: false, defaultBranch: null, currentBranch: null, branches: [] },
      }),
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
