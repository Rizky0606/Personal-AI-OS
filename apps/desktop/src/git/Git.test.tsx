import type { GitStatus } from '@aios/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../copy';
import { useUiStore } from '../state/uiStore';
import { resetApi, setWorker, workerApi } from '../test/fakeServices';
import { renderScreen } from '../test/render';

vi.mock('../app/services', async () => (await import('../test/fakeServices')).fakeServices);

const { GitPanel } = await import('./GitPanel');

const PROJECT = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';

const status = (over: Partial<GitStatus> = {}): GitStatus => ({
  isRepo: true,
  branch: 'fitur-login',
  upstream: 'origin/fitur-login',
  ahead: 2,
  behind: 0,
  truncated: false,
  files: [
    { path: 'src/a.ts', status: 'modified', staged: false, unstaged: true },
    { path: 'src/baru.ts', status: 'untracked', staged: false, unstaged: true },
    { path: 'BACA.md', oldPath: 'README.md', status: 'renamed', staged: true, unstaged: false },
  ],
  ...over,
});

beforeEach(() => {
  resetApi();
  setWorker({ local: 'connected', status: null });
  useUiStore.setState({ activeProjectId: PROJECT });
  workerApi.gitStatus.mockResolvedValue(status());
  workerApi.gitLog.mockResolvedValue({
    commits: [
      {
        hash: 'a'.repeat(40),
        shortHash: 'aaaaaaa',
        subject: 'feat: tambah login',
        author: 'Rizky',
        date: '2026-10-27T08:00:00Z',
      },
    ],
  });
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

describe('GitPanel', () => {
  it('tanpa project atau worker offline: pesan, tanpa memanggil worker', async () => {
    useUiStore.setState({ activeProjectId: null });
    const first = await renderScreen(<GitPanel />);
    expect(await screen.findByText(copy.git.noProject)).toBeInTheDocument();
    first.unmount();

    useUiStore.setState({ activeProjectId: PROJECT });
    setWorker({ local: 'off', status: null });
    await renderScreen(<GitPanel />);
    expect(await screen.findByText(copy.git.workerOffline)).toBeInTheDocument();
    expect(workerApi.gitStatus).not.toHaveBeenCalled();
  });

  it('menampilkan branch, posisi terhadap upstream, berkas yang berubah, dan commit terbaru', async () => {
    await renderScreen(<GitPanel />);

    expect(await screen.findByText('fitur-login')).toBeInTheDocument();
    expect(screen.getByText(copy.git.ahead(2))).toBeInTheDocument();
    const changes = screen.getByRole('region', { name: copy.git.changes(3) });
    expect(within(changes).getAllByRole('listitem')).toHaveLength(3);
    expect(within(changes).getByText(copy.git.status.untracked)).toBeInTheDocument();
    expect(within(changes).getByText(copy.git.renamedFrom('README.md'))).toBeInTheDocument();
    expect(within(changes).getByText(copy.git.staged)).toBeInTheDocument();

    const history = screen.getByRole('region', { name: copy.git.history });
    expect(within(history).getByText('feat: tambah login')).toBeInTheDocument();
    expect(within(history).getByText('aaaaaaa')).toBeInTheDocument();
  });

  it('klik berkas menampilkan perubahannya baris demi baris tanpa tombol komentar; kembali ke daftar', async () => {
    workerApi.gitDiff.mockResolvedValue({
      path: 'src/a.ts',
      patch: '@@ -1,2 +1,2 @@\n export const x = 1;\n-export const a = 1;\n+export const a = 2;\n',
      binary: false,
      truncated: false,
    });
    const user = userEvent.setup();
    await renderScreen(<GitPanel />);

    await user.click(await screen.findByRole('button', { name: `${copy.git.openDiff}: src/a.ts` }));
    // Teks baris dipecah per token sintaks, jadi dicek lewat isi keseluruhan.
    await waitFor(() => expect(document.body.textContent).toContain('export const a = 2;'));
    expect(document.body.textContent).toContain('export const a = 1;');
    expect(workerApi.gitDiff).toHaveBeenCalledWith({ projectId: PROJECT }, 'src/a.ts');
    expect(screen.queryByRole('button', { name: /komentari/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: copy.git.back }));
    expect(await screen.findByRole('region', { name: copy.git.changes(3) })).toBeInTheDocument();
  });

  it('berkas biner tidak menampilkan isi', async () => {
    workerApi.gitDiff.mockResolvedValue({
      path: 'src/a.ts',
      patch: '',
      binary: true,
      truncated: false,
    });
    const user = userEvent.setup();
    await renderScreen(<GitPanel />);
    await user.click(await screen.findByRole('button', { name: `${copy.git.openDiff}: src/a.ts` }));
    expect(await screen.findByText(copy.git.binary)).toBeInTheDocument();
  });

  it('repo bersih: keterangan kosong; bukan repo git: pesan dan tanpa memuat riwayat', async () => {
    workerApi.gitStatus.mockResolvedValue(status({ files: [], ahead: 0 }));
    const first = await renderScreen(<GitPanel />);
    expect(await screen.findByText(copy.git.clean)).toBeInTheDocument();
    first.unmount();

    workerApi.gitStatus.mockResolvedValue(status({ isRepo: false, branch: null, files: [] }));
    workerApi.gitLog.mockClear();
    await renderScreen(<GitPanel />);
    expect(await screen.findByText(copy.git.notRepo)).toBeInTheDocument();
    expect(workerApi.gitLog).not.toHaveBeenCalled();
  });

  it('tombol segarkan membaca status lagi', async () => {
    const user = userEvent.setup();
    await renderScreen(<GitPanel />);
    await screen.findByText('fitur-login');
    const before = workerApi.gitStatus.mock.calls.length;

    await user.click(screen.getByRole('button', { name: copy.git.refresh }));
    await waitFor(() => expect(workerApi.gitStatus.mock.calls.length).toBeGreaterThan(before));
  });
});
