import type { Project, Task } from '@aios/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProblem } from '../auth/authSession';
import { copy } from '../copy';
import { useUiStore } from '../state/uiStore';
import { api, resetApi } from '../test/fakeServices';
import { TS, roles, uid } from '../test/fixtures';
import { renderScreen } from '../test/render';

vi.mock('../app/services', async () => (await import('../test/fakeServices')).fakeServices);

const { KanbanScreen } = await import('./KanbanScreen');

const PROJECT = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';
const RUN = '0192f0c4-7a1b-7c2d-9e3f-4a5b6c7d8e90';

const project: Project = {
  id: PROJECT,
  name: 'Toko',
  workerDeviceId: '0192f0c4-7a1b-7c2d-a001-4a5b6c7d8e91',
  stack: { languages: ['typescript'], frameworks: [] },
  defaultBranch: 'main',
  instructions: '',
  createdAt: TS,
  updatedAt: TS,
};

function task(over: Partial<Task> = {}): Task {
  return {
    id: uid(),
    projectId: PROJECT,
    title: 'Kartu',
    body: '',
    status: 'backlog',
    position: 0,
    agentRole: null,
    runId: null,
    branch: null,
    diffStat: null,
    createdAt: TS,
    updatedAt: TS,
    ...over,
  };
}

beforeEach(() => {
  resetApi();
  api.listProjects.mockResolvedValue([project]);
  api.listRoles.mockResolvedValue(roles);
  api.listTasks.mockResolvedValue([]);
  useUiStore.setState({
    activeProjectId: PROJECT,
    reviewRunId: null,
    rightPanelOpen: false,
    rightPanelTab: 'preview',
  });
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

/** Tombol judul kartu (namanya diawali status untuk pembaca layar); bukan tombol menu kartu. */
const titleOf = (title: string) => new RegExp(`^(?!Menu kartu).*${title}$`);

const column = (name: keyof typeof copy.kanban.columns, count: number) =>
  screen.findByRole('region', { name: copy.kanban.columnCount(copy.kanban.columns[name], count) });

describe('KanbanScreen: keadaan layar', () => {
  it('tanpa project aktif: mengajak memilih project', async () => {
    useUiStore.setState({ activeProjectId: null });
    await renderScreen(<KanbanScreen />, '/kanban');

    expect(await screen.findByText(copy.kanban.noProject)).toBeInTheDocument();
  });

  it('tanpa project aktif: tombol Pilih project membuka layar Project', async () => {
    useUiStore.setState({ activeProjectId: null });
    const user = userEvent.setup();
    const { router } = await renderScreen(<KanbanScreen />, '/kanban');

    await user.click(await screen.findByRole('button', { name: copy.kanban.pickProject }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/workspace'));
  });

  it('memuat: menampilkan skeleton berlabel', async () => {
    api.listTasks.mockReturnValue(new Promise(() => undefined));
    await renderScreen(<KanbanScreen />, '/kanban');

    expect(await screen.findByLabelText(copy.kanban.loading)).toBeInTheDocument();
  });

  it('kosong: satu kalimat dan tombol aksi', async () => {
    await renderScreen(<KanbanScreen />, '/kanban');

    expect(await screen.findByText(copy.kanban.empty)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: copy.kanban.newTask })).not.toHaveLength(0);
  });

  it('error: pesan dengan tombol coba lagi yang memuat ulang', async () => {
    api.listTasks.mockRejectedValueOnce(new ApiProblem(500, 'internal_error', 'Server gagal'));
    const user = userEvent.setup();
    await renderScreen(<KanbanScreen />, '/kanban');

    await user.click(await screen.findByRole('button', { name: copy.states.retry }));

    expect(api.listTasks).toHaveBeenCalledTimes(2);
  });

  it('offline: pesan offline, bukan error', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    api.listTasks.mockRejectedValue(new Error('jaringan'));
    await renderScreen(<KanbanScreen />, '/kanban');

    expect(await screen.findByText(copy.states.offline)).toBeInTheDocument();
  });
});

describe('KanbanScreen: papan', () => {
  it('lima kolom dengan jumlah kartu; kartu menampilkan role, diff stat, branch, dan status', async () => {
    api.listTasks.mockResolvedValue([
      task({ title: 'Tulis tes', status: 'todo' }),
      task({ title: 'Ide lain', status: 'backlog' }),
      task({
        title: 'Tombol baru',
        status: 'review',
        runId: RUN,
        agentRole: 'project',
        branch: 'aios/abcd1234',
        diffStat: { files: 2, additions: 12, deletions: 3 },
      }),
    ]);
    await renderScreen(<KanbanScreen />, '/kanban');

    const review = await column('review', 1);
    expect(within(review).getByText('+12 −3')).toBeInTheDocument();
    expect(within(review).getByText('aios/abcd1234')).toBeInTheDocument();
    expect(within(review).getByText('Project')).toBeInTheDocument();
    expect(within(review).getByText(`${copy.kanban.status.review}:`)).toBeInTheDocument();
    await column('backlog', 1);
    await column('todo', 1);
    await column('running', 0);
    await column('done', 0);
    // Kartu tanpa role memberi tahu bahwa router yang memilih.
    expect(within(await column('todo', 1)).getByText(copy.kanban.role.auto)).toBeInTheDocument();
  });

  it('klik kartu di Review membuka tab Diff untuk run-nya', async () => {
    api.listTasks.mockResolvedValue([task({ title: 'Siap tinjau', status: 'review', runId: RUN })]);
    const user = userEvent.setup();
    await renderScreen(<KanbanScreen />, '/kanban');

    await user.click(await screen.findByRole('button', { name: titleOf('Siap tinjau') }));

    expect(useUiStore.getState()).toMatchObject({
      reviewRunId: RUN,
      rightPanelOpen: true,
      rightPanelTab: 'diff',
    });
  });

  it('klik kartu lain membuka dialog kartu dengan deskripsi Markdown', async () => {
    api.listTasks.mockResolvedValue([
      task({ title: 'Ada deskripsi', status: 'todo', body: 'Tambahkan **tombol** di header' }),
    ]);
    const user = userEvent.setup();
    await renderScreen(<KanbanScreen />, '/kanban');

    await user.click(await screen.findByRole('button', { name: titleOf('Ada deskripsi') }));
    const dialog = await screen.findByRole('dialog', { name: copy.kanban.dialog.editTitle });
    expect(within(dialog).getByLabelText(copy.kanban.dialog.name)).toHaveValue('Ada deskripsi');
    await user.click(within(dialog).getByRole('button', { name: copy.kanban.dialog.preview }));

    expect(within(dialog).getByText('tombol').tagName).toBe('STRONG');
  });

  it('kartu yang sedang dikerjakan terkunci: tidak bisa diseret, tersedia hentikan run, dan hanya dilihat', async () => {
    api.listTasks.mockResolvedValue([
      task({ title: 'Sedang jalan', status: 'running', runId: RUN, agentRole: 'project' }),
    ]);
    api.cancelRun.mockResolvedValue({} as never);
    const user = userEvent.setup();
    await renderScreen(<KanbanScreen />, '/kanban');

    const card = await screen.findByRole('article', { name: 'Sedang jalan' });
    expect(card).toHaveAttribute('draggable', 'false');
    await user.click(screen.getByRole('button', { name: copy.kanban.cardMenu('Sedang jalan') }));
    expect(screen.queryByRole('menuitem', { name: copy.kanban.moveUp })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: copy.kanban.runWithAi })).toBeNull();
    await user.click(await screen.findByRole('menuitem', { name: copy.kanban.cancelRun }));

    expect(api.cancelRun).toHaveBeenCalledWith(RUN);
  });
});

describe('KanbanScreen: Kerjakan dengan AI', () => {
  it('menu kartu memanggil runTask dan memberi kabar; kartu antre menampilkan penandanya', async () => {
    const card = task({ title: 'Kerjakan aku', status: 'todo' });
    api.listTasks.mockResolvedValue([card]);
    api.runTask.mockResolvedValue({ ...card, status: 'running', runId: null });
    const user = userEvent.setup();
    await renderScreen(<KanbanScreen />, '/kanban');

    await user.click(
      await screen.findByRole('button', { name: copy.kanban.cardMenu('Kerjakan aku') }),
    );
    await user.click(await screen.findByRole('menuitem', { name: copy.kanban.runWithAi }));

    expect(api.runTask).toHaveBeenCalledWith(card.id);
    expect(await screen.findByText(copy.kanban.queuedToast)).toBeInTheDocument();
  });

  it('kesalahan server (mis. role bukan coding) menjadi toast, bukan layar rusak', async () => {
    const card = task({ title: 'Gagal', status: 'backlog' });
    api.listTasks.mockResolvedValue([card]);
    api.runTask.mockRejectedValue(
      new ApiProblem(
        409,
        'task_not_runnable',
        'Kartu ini sedang dikerjakan atau menunggu tinjauan.',
      ),
    );
    const user = userEvent.setup();
    await renderScreen(<KanbanScreen />, '/kanban');

    await user.click(await screen.findByRole('button', { name: copy.kanban.cardMenu('Gagal') }));
    await user.click(await screen.findByRole('menuitem', { name: copy.kanban.runWithAi }));

    expect(await screen.findByText(/sedang dikerjakan atau menunggu tinjauan/)).toBeInTheDocument();
  });
});

describe('KanbanScreen: memindahkan kartu', () => {
  it('seret ke kolom lain memanggil updateTask dengan kolom dan posisi tujuan', async () => {
    const a = task({ title: 'Satu', status: 'backlog' });
    const b = task({ title: 'Dua', status: 'todo', position: 0 });
    api.listTasks.mockResolvedValue([a, b]);
    api.updateTask.mockResolvedValue({ ...a, status: 'todo' });
    await renderScreen(<KanbanScreen />, '/kanban');

    const card = await screen.findByRole('article', { name: 'Satu' });
    const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(card, { dataTransfer });
    const todo = await column('todo', 1);
    fireEvent.dragOver(todo, { dataTransfer });
    fireEvent.drop(todo, { dataTransfer });

    await waitFor(() =>
      expect(api.updateTask).toHaveBeenCalledWith(a.id, { status: 'todo', position: 1 }),
    );
  });

  it('lepas di atas kartu lain menyisipkan sebelum kartu itu', async () => {
    const a = task({ title: 'Satu', status: 'backlog' });
    const b = task({ title: 'Dua', status: 'todo', position: 0 });
    const c = task({ title: 'Tiga', status: 'todo', position: 1 });
    api.listTasks.mockResolvedValue([a, b, c]);
    api.updateTask.mockResolvedValue({ ...a, status: 'todo' });
    await renderScreen(<KanbanScreen />, '/kanban');

    const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(await screen.findByRole('article', { name: 'Satu' }), { dataTransfer });
    fireEvent.drop((await screen.findByRole('article', { name: 'Tiga' })).closest('li')!, {
      dataTransfer,
    });

    await waitFor(() =>
      expect(api.updateTask).toHaveBeenCalledWith(a.id, { status: 'todo', position: 1 }),
    );
  });

  it('Running dan Review tidak menerima lepasan', async () => {
    const a = task({ title: 'Satu', status: 'backlog' });
    api.listTasks.mockResolvedValue([a]);
    await renderScreen(<KanbanScreen />, '/kanban');

    const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(await screen.findByRole('article', { name: 'Satu' }), { dataTransfer });
    fireEvent.drop(await column('running', 0), { dataTransfer });
    fireEvent.drop(await column('review', 0), { dataTransfer });

    expect(api.updateTask).not.toHaveBeenCalled();
  });

  it('keyboard: Alt + panah menggeser kartu tanpa mouse', async () => {
    const a = task({ title: 'Satu', status: 'todo', position: 0 });
    const b = task({ title: 'Dua', status: 'todo', position: 1 });
    api.listTasks.mockResolvedValue([a, b]);
    api.updateTask.mockResolvedValue(a);
    const user = userEvent.setup();
    await renderScreen(<KanbanScreen />, '/kanban');

    const first = await screen.findByRole('button', { name: titleOf('Satu') });
    first.focus();
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    await waitFor(() =>
      expect(api.updateTask).toHaveBeenLastCalledWith(a.id, { status: 'todo', position: 1 }),
    );
    await user.keyboard('{Alt>}{ArrowRight}{/Alt}');
    await waitFor(() =>
      expect(api.updateTask).toHaveBeenLastCalledWith(a.id, { status: 'done', position: 0 }),
    );
  });

  it('menu kartu: Pindah ke kolom lain; gagal dari server menjadi toast', async () => {
    const a = task({ title: 'Pindahkan', status: 'backlog' });
    api.listTasks.mockResolvedValue([a]);
    api.updateTask.mockRejectedValue(
      new ApiProblem(409, 'task_running', 'Kartu sedang dikerjakan.'),
    );
    const user = userEvent.setup();
    await renderScreen(<KanbanScreen />, '/kanban');

    await user.click(
      await screen.findByRole('button', { name: copy.kanban.cardMenu('Pindahkan') }),
    );
    await user.click(
      await screen.findByRole('menuitem', { name: copy.kanban.moveTo(copy.kanban.columns.done) }),
    );

    expect(api.updateTask).toHaveBeenCalledWith(a.id, { status: 'done', position: 0 });
    expect(await screen.findByText('Kartu sedang dikerjakan.')).toBeInTheDocument();
  });
});

describe('KanbanScreen: kartu baru dan pecah dengan AI', () => {
  it('kartu baru: judul wajib; disimpan ke project aktif', async () => {
    api.listTasks.mockResolvedValue([task({ title: 'Ada', status: 'todo' })]);
    api.createTask.mockResolvedValue(task({ title: 'Baru' }));
    const user = userEvent.setup();
    await renderScreen(<KanbanScreen />, '/kanban');

    await user.click(await screen.findByRole('button', { name: copy.kanban.newTask }));
    const dialog = await screen.findByRole('dialog', { name: copy.kanban.dialog.createTitle });
    await user.click(within(dialog).getByRole('button', { name: copy.kanban.dialog.save }));
    expect(await within(dialog).findByText(copy.kanban.dialog.emptyName)).toBeInTheDocument();
    expect(api.createTask).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText(copy.kanban.dialog.name), 'Tambah dark mode');
    await user.type(within(dialog).getByLabelText(copy.kanban.dialog.body), 'Ikuti tema sistem');
    await user.click(within(dialog).getByRole('button', { name: copy.kanban.dialog.save }));

    await waitFor(() =>
      expect(api.createTask).toHaveBeenCalledWith({
        projectId: PROJECT,
        title: 'Tambah dark mode',
        body: 'Ikuti tema sistem',
        agentRole: null,
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('pecah dengan AI: mengusulkan kartu, pengguna memilih, hanya yang dipilih disimpan berurutan', async () => {
    api.listTasks.mockResolvedValue([task({ title: 'Ada', status: 'todo' })]);
    api.breakdownTasks.mockResolvedValue([
      { title: 'Halaman login', body: 'Form email dan sandi', agentRole: 'project' },
      { title: 'Catatan rilis', body: '', agentRole: null },
      { title: 'Endpoint login', body: '', agentRole: 'project' },
    ]);
    api.createTask.mockResolvedValue(task());
    const user = userEvent.setup();
    await renderScreen(<KanbanScreen />, '/kanban');

    await user.click(await screen.findByRole('button', { name: copy.kanban.breakdown }));
    const dialog = await screen.findByRole('dialog', { name: copy.kanban.breakdownDialog.title });
    await user.click(
      within(dialog).getByRole('button', { name: copy.kanban.breakdownDialog.propose }),
    );
    expect(
      await within(dialog).findByText(copy.kanban.breakdownDialog.emptyIdea),
    ).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText(copy.kanban.breakdownDialog.idea), 'Buat login');
    await user.click(
      within(dialog).getByRole('button', { name: copy.kanban.breakdownDialog.propose }),
    );
    expect(api.breakdownTasks).toHaveBeenCalledWith(PROJECT, 'Buat login');

    await user.click(await within(dialog).findByRole('checkbox', { name: /Catatan rilis/ }));
    await user.click(
      within(dialog).getByRole('button', { name: copy.kanban.breakdownDialog.save(2) }),
    );

    await waitFor(() => expect(api.createTask).toHaveBeenCalledTimes(2));
    expect(api.createTask.mock.calls.map(([input]) => input.title)).toEqual([
      'Halaman login',
      'Endpoint login',
    ]);
    expect(await screen.findByText(copy.kanban.breakdownDialog.saved(2))).toBeInTheDocument();
  });

  it('pecah dengan AI gagal: pesan error di dalam dialog, ide tetap ada', async () => {
    api.listTasks.mockResolvedValue([task({ title: 'Ada', status: 'todo' })]);
    api.breakdownTasks.mockRejectedValue(
      new ApiProblem(422, 'breakdown_unparseable', 'Itu bukan pekerjaan coding.'),
    );
    const user = userEvent.setup();
    await renderScreen(<KanbanScreen />, '/kanban');

    await user.click(await screen.findByRole('button', { name: copy.kanban.breakdown }));
    const dialog = await screen.findByRole('dialog', { name: copy.kanban.breakdownDialog.title });
    await user.type(within(dialog).getByLabelText(copy.kanban.breakdownDialog.idea), 'Resep nasi');
    await user.click(
      within(dialog).getByRole('button', { name: copy.kanban.breakdownDialog.propose }),
    );

    expect(await within(dialog).findByText('Itu bukan pekerjaan coding.')).toBeInTheDocument();
    expect(within(dialog).getByLabelText(copy.kanban.breakdownDialog.idea)).toHaveValue(
      'Resep nasi',
    );
  });
});

describe('KanbanScreen: tampilan sesi 6', () => {
  it('header tiap kolom memuat penanda warna status (token), bukan hanya teks', async () => {
    api.listTasks.mockResolvedValue([task({ title: 'Satu', status: 'todo' })]);
    await renderScreen(<KanbanScreen />, '/kanban');
    const todo = await column('todo', 1);
    expect(todo).toHaveAttribute('data-status', 'todo');
    expect(within(todo).getByTestId('column-dot')).toHaveClass('bg-info');
    expect((await column('done', 0)).querySelector('[data-testid="column-dot"]')).toHaveClass(
      'bg-success',
    );
  });

  it('kartu yang dikerjakan agent menampilkan Orb kecil dan fase singkat; kartu lain tidak', async () => {
    api.listTasks.mockResolvedValue([
      task({ title: 'Jalan', status: 'running', runId: RUN }),
      task({ title: 'Diam', status: 'todo' }),
    ]);
    await renderScreen(<KanbanScreen />, '/kanban');
    const running = await screen.findByRole('article', { name: 'Jalan' });
    expect(within(running).getByTestId('agent-orb')).toHaveAttribute('width', '16');
    expect(within(running).getByText(copy.runActivity.ui.phase.tool)).toBeInTheDocument();
    const idle = await screen.findByRole('article', { name: 'Diam' });
    expect(within(idle).queryByTestId('agent-orb')).not.toBeInTheDocument();
  });

  it('saat diseret: penanda sisip tampil di atas kartu tujuan, hilang setelah dilepas', async () => {
    const a = task({ title: 'Satu', status: 'backlog' });
    const b = task({ title: 'Dua', status: 'todo', position: 0 });
    api.listTasks.mockResolvedValue([a, b]);
    api.updateTask.mockResolvedValue({ ...a, status: 'todo' });
    await renderScreen(<KanbanScreen />, '/kanban');

    const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(await screen.findByRole('article', { name: 'Satu' }), { dataTransfer });
    const target = (await screen.findByRole('article', { name: 'Dua' })).closest('li')!;
    expect(screen.queryByTestId('drop-marker')).not.toBeInTheDocument();
    fireEvent.dragOver(target, { dataTransfer });
    expect(screen.getByTestId('drop-marker')).toBeInTheDocument();
    fireEvent.drop(target, { dataTransfer });
    await waitFor(() => expect(api.updateTask).toHaveBeenCalled());
    expect(screen.queryByTestId('drop-marker')).not.toBeInTheDocument();
  });

  it('kartu yang baru dilepas ditandai mendarat (animasi pegas) lalu dibersihkan', async () => {
    const a = task({ title: 'Satu', status: 'backlog' });
    api.listTasks.mockResolvedValue([a]);
    api.updateTask.mockResolvedValue({ ...a, status: 'todo' });
    await renderScreen(<KanbanScreen />, '/kanban');

    const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(await screen.findByRole('article', { name: 'Satu' }), { dataTransfer });
    const todo = await column('todo', 0);
    fireEvent.dragOver(todo, { dataTransfer });
    fireEvent.drop(todo, { dataTransfer });
    expect(screen.getByRole('article', { name: 'Satu' })).toHaveAttribute('data-landed', 'true');
    await waitFor(
      () =>
        expect(screen.getByRole('article', { name: 'Satu' })).not.toHaveAttribute('data-landed'),
      { timeout: 1500 },
    );
  });
});
