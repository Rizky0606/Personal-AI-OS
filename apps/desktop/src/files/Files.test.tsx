import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../copy';
import { useUiStore } from '../state/uiStore';
import { resetApi, setWorker, workerApi } from '../test/fakeServices';
import { renderScreen } from '../test/render';
import { WorkerCallError } from '../worker/localClient';

vi.mock('../app/services', async () => (await import('../test/fakeServices')).fakeServices);

const { FilesPanel } = await import('./FilesPanel');
const { MAX_ATTACH_CHARS, attachmentText } = await import('./FileViewer');

const PROJECT = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';

const entry = (path: string, kind: 'dir' | 'file' = 'file') => ({
  name: path.split('/').at(-1)!,
  path,
  kind,
  size: 10,
});
const text = (path: string, content: string) => ({
  path,
  size: content.length,
  kind: 'text' as const,
  mime: 'text/plain',
  content,
  truncated: false,
});

beforeEach(() => {
  resetApi();
  setWorker({ local: 'connected', status: null });
  useUiStore.setState({ activeProjectId: PROJECT, reviewRunId: null, attachments: [] });
  workerApi.filesList.mockImplementation((_target, path) =>
    Promise.resolve(
      path === ''
        ? { path: '', entries: [entry('src', 'dir'), entry('README.md')], truncated: false }
        : { path, entries: [entry('src/main.ts')], truncated: false },
    ),
  );
  workerApi.filesFind.mockResolvedValue([]);
});

describe('FilesPanel', () => {
  it('tanpa project atau worker offline: pesan, tanpa memanggil worker', async () => {
    useUiStore.setState({ activeProjectId: null });
    const first = await renderScreen(<FilesPanel />);
    expect(await screen.findByText(copy.files.noProject)).toBeInTheDocument();
    first.unmount();

    useUiStore.setState({ activeProjectId: PROJECT });
    setWorker({ local: 'off', status: null });
    await renderScreen(<FilesPanel />);
    expect(await screen.findByText(copy.files.workerOffline)).toBeInTheDocument();
    expect(workerApi.filesList).not.toHaveBeenCalled();
  });

  it('pohon: folder dibuka malas, berkas dibuka dengan nomor baris, lalu kembali', async () => {
    workerApi.filesRead.mockResolvedValue(text('src/main.ts', 'const a = 1;\nconst b = 2;'));
    const user = userEvent.setup();
    await renderScreen(<FilesPanel />);

    const tree = await screen.findByRole('tree', { name: copy.files.tree });
    expect(within(tree).getAllByRole('treeitem')).toHaveLength(2);
    expect(workerApi.filesList).toHaveBeenCalledTimes(1);

    await user.click(within(tree).getByRole('button', { name: 'src' }));
    await user.click(await screen.findByRole('button', { name: 'main.ts' }));
    expect(workerApi.filesList).toHaveBeenCalledWith({ projectId: PROJECT }, 'src');
    expect(workerApi.filesRead).toHaveBeenCalledWith({ projectId: PROJECT }, 'src/main.ts');

    const code = await screen.findByRole('list', { name: copy.files.content });
    expect(within(code).getAllByRole('listitem')).toHaveLength(2);
    expect(code).toHaveTextContent('const b = 2;');

    await user.click(screen.getByRole('button', { name: copy.files.back }));
    expect(await screen.findByRole('tree', { name: copy.files.tree })).toBeVisible();
  });

  it('worktree run yang ditinjau dipakai sebagai target', async () => {
    const run = '0192f0c4-7a1b-7c2d-9e3f-4a5b6c7d8e90';
    useUiStore.setState({ reviewRunId: run });
    await renderScreen(<FilesPanel />);
    await screen.findByRole('tree');
    expect(workerApi.filesList).toHaveBeenCalledWith({ projectId: PROJECT, runId: run }, '');
  });

  it('Markdown tampil dirender dan bisa dilihat sumbernya', async () => {
    workerApi.filesRead.mockResolvedValue(text('README.md', '# Judul Proyek\n\nIsi.'));
    const user = userEvent.setup();
    await renderScreen(<FilesPanel />);
    await user.click(await screen.findByRole('button', { name: 'README.md' }));

    expect(await screen.findByRole('heading', { name: 'Judul Proyek' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: copy.files.source }));
    expect(screen.queryByRole('heading', { name: 'Judul Proyek' })).not.toBeInTheDocument();
    expect(screen.getByRole('list', { name: copy.files.content })).toHaveTextContent(
      '# Judul Proyek',
    );
  });

  it('gambar tampil sebagai img; biner dan terlalu besar dijelaskan', async () => {
    const user = userEvent.setup();
    workerApi.filesRead.mockResolvedValue({
      path: 'README.md',
      size: 4,
      kind: 'image',
      mime: 'image/png',
      content: 'iVBORw==',
      truncated: false,
    });
    const view = await renderScreen(<FilesPanel />);
    await user.click(await screen.findByRole('button', { name: 'README.md' }));
    expect(await screen.findByRole('img', { name: 'README.md' })).toHaveAttribute(
      'src',
      'data:image/png;base64,iVBORw==',
    );
    view.unmount();

    workerApi.filesRead.mockResolvedValue({
      path: 'README.md',
      size: 4,
      kind: 'binary',
      mime: 'application/octet-stream',
      content: '',
      truncated: false,
    });
    await renderScreen(<FilesPanel />);
    await user.click(await screen.findByRole('button', { name: 'README.md' }));
    expect(await screen.findByText(copy.files.binary)).toBeInTheDocument();
  });

  it('Kirim ke prompt menambah lampiran konteks berisi berkas sebagai blok kode', async () => {
    workerApi.filesRead.mockResolvedValue(text('src/main.ts', 'export {};'));
    const user = userEvent.setup();
    await renderScreen(<FilesPanel />);
    await user.click(await screen.findByRole('button', { name: 'src' }));
    await user.click(await screen.findByRole('button', { name: 'main.ts' }));
    await user.click(await screen.findByRole('button', { name: copy.files.attach }));

    expect(useUiStore.getState().attachments).toEqual([
      {
        id: 'file:src/main.ts',
        label: 'src/main.ts',
        text: '```typescript src/main.ts\nexport {};\n```',
      },
    ]);
  });

  it('attachmentText memotong berkas panjang dan memberi catatan', () => {
    const out = attachmentText('a.txt', 'x'.repeat(MAX_ATTACH_CHARS + 5));
    expect(out).toContain('[dipotong:');
    expect(out.length).toBeLessThan(MAX_ATTACH_CHARS + 120);
  });

  it('quick-open: hasil pencarian membuka berkas; tidak cocok diberitahu', async () => {
    workerApi.filesFind.mockImplementation((_t, query) =>
      Promise.resolve(query === 'main' ? ['src/main.ts'] : []),
    );
    workerApi.filesRead.mockResolvedValue(text('src/main.ts', 'ok'));
    const user = userEvent.setup();
    await renderScreen(<FilesPanel />);

    const input = await screen.findByRole('searchbox', { name: copy.files.quickOpen });
    await user.type(input, 'zzz');
    expect(await screen.findByText(copy.files.noResults)).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, 'main');
    await user.click(await screen.findByRole('button', { name: 'src/main.ts' }));
    await waitFor(() =>
      expect(workerApi.filesRead).toHaveBeenCalledWith({ projectId: PROJECT }, 'src/main.ts'),
    );
  });

  it('galat dari worker ditampilkan dengan Coba lagi', async () => {
    workerApi.filesList.mockRejectedValueOnce(
      new WorkerCallError('path_not_found', 'Folder tidak ditemukan.'),
    );
    const user = userEvent.setup();
    await renderScreen(<FilesPanel />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: copy.states.retry }));
    expect(await screen.findByRole('tree')).toBeInTheDocument();
  });
});

describe('FilesPanel: aksi keadaan kosong', () => {
  it.each([
    ['tanpa project', null, 'connected', copy.states.pickProject, '/workspace'],
    ['worker offline', PROJECT, 'off', copy.states.viewStatus, '/status'],
  ] as const)(
    '%s: tombol menuju layar yang memperbaikinya',
    async (_n, project, local, label, path) => {
      useUiStore.setState({ activeProjectId: project });
      setWorker({ local, status: null });
      const user = userEvent.setup();
      const { router } = await renderScreen(<FilesPanel />);
      await user.click(await screen.findByRole('button', { name: label }));
      await waitFor(() => expect(router.state.location.pathname).toBe(path));
    },
  );

  it('folder kosong: tombol Muat ulang membaca daftar lagi', async () => {
    workerApi.filesList.mockResolvedValue({ path: '', entries: [], truncated: false });
    const user = userEvent.setup();
    await renderScreen(<FilesPanel />);
    await user.click(await screen.findByRole('button', { name: copy.files.refresh }));
    await waitFor(() => expect(workerApi.filesList).toHaveBeenCalledTimes(2));
  });

  it('berkas kosong: tombol Tutup berkas kembali ke pohon', async () => {
    workerApi.filesRead.mockResolvedValue(text('README.md', ''));
    const user = userEvent.setup();
    await renderScreen(<FilesPanel />);
    await user.click(await screen.findByRole('button', { name: 'README.md' }));
    expect(await screen.findByText(copy.files.emptyFile)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: copy.files.closeFile }));
    expect(await screen.findByRole('tree', { name: copy.files.tree })).toBeVisible();
  });
});
