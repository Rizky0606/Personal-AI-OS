import type { ReviewState } from '@aios/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProblem } from '../auth/authSession';
import { copy } from '../copy';
import { useUiStore } from '../state/uiStore';
import { TS, run, uid } from '../test/fixtures';
import { api, resetApi, setWorker, workerApi } from '../test/fakeServices';
import { renderScreen } from '../test/render';
import { WorkerCallError } from '../worker/localClient';

vi.mock('../app/services', async () => (await import('../test/fakeServices')).fakeServices);

const { DiffPanel } = await import('./DiffPanel');

let RUN = '';
const SHA_1 = 'a'.repeat(40);
const SHA_2 = 'b'.repeat(40);

const PATCH_MATH = [
  'diff --git a/math.js b/math.js',
  '--- a/math.js',
  '+++ b/math.js',
  '@@ -1,2 +1,4 @@',
  ' export const add = (a, b) => a + b;',
  '+export const sub = (a, b) => a - b;',
  '+export const mul = (a, b) => a * b;',
  ' export default add;',
  '',
].join('\n');

const state = (over: Partial<ReviewState> = {}): ReviewState => ({
  runId: RUN,
  branch: 'aios/abcd1234',
  base: 'f'.repeat(40),
  targetBranch: 'main',
  commitMessage: 'feat: tambah sub dan mul',
  files: [
    {
      path: 'math.js',
      status: 'modified',
      additions: 2,
      deletions: 0,
      binary: false,
      patch: PATCH_MATH,
      truncated: false,
    },
    {
      path: 'gambar.png',
      status: 'added',
      additions: 0,
      deletions: 0,
      binary: true,
      patch: '',
      truncated: false,
    },
  ],
  checkpoints: [
    { id: SHA_1, label: 'write math.js', ts: TS },
    { id: SHA_2, label: 'edit math.js', ts: TS },
  ],
  ...over,
});

const accepted = {
  run: run({ id: 'x', status: 'accepted' }),
  branch: 'aios/abcd1234',
  commit: SHA_1,
  merged: false,
  mergeSkipped: null,
  revisionRunId: null,
};

beforeEach(() => {
  RUN = uid();
  resetApi();
  useUiStore.setState(useUiStore.getInitialState(), true);
  useUiStore.getState().setReviewRunId(RUN);
  setWorker({ local: 'connected', status: null });
  workerApi.reviewGet.mockImplementation(() => Promise.resolve(state()));
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

const open = async () => {
  const view = await renderScreen(<DiffPanel />);
  await screen.findByRole('heading', { name: copy.review.title });
  await screen.findByRole('article', { name: 'math.js' });
  return view;
};

describe('Tinjau perubahan: tampilan', () => {
  it('tanpa run yang menunggu tinjauan: petunjuk; dengan run: ringkasan, branch, dan file', async () => {
    useUiStore.getState().setReviewRunId(null);
    const view = await renderScreen(<DiffPanel />);
    expect(await screen.findByText(copy.review.empty)).toBeInTheDocument();
    view.unmount();
    useUiStore.getState().setReviewRunId(RUN);

    await open();

    expect(workerApi.reviewGet).toHaveBeenCalledWith(RUN);
    expect(screen.getByText(/2 file/)).toBeInTheDocument();
    expect(screen.getByText('aios/abcd1234 → main')).toBeInTheDocument();
    const list = screen.getByRole('navigation', { name: copy.review.filesLabel });
    expect(within(list).getByText('math.js')).toBeInTheDocument();
    expect(within(list).getByText('gambar.png')).toBeInTheDocument();
    expect(screen.getByText(copy.review.binary)).toBeInTheDocument();
  });

  it('unified: nomor baris lama/baru, baris tambah, dan warna sintaks; split: dua sisi', async () => {
    const user = userEvent.setup();
    const { container } = await open();

    expect(screen.getByRole('button', { name: copy.review.commentLine(2) })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: copy.review.commentLine(1) })).toBeNull();
    expect(container.querySelector('.hljs-keyword')?.textContent).toBe('export');
    expect(container.textContent).toContain('export const sub = (a, b) => a - b;');

    await user.click(screen.getByRole('button', { name: copy.review.view.split }));

    expect(screen.getByRole('button', { name: copy.review.view.split })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Baris konteks tampil di kedua sisi; baris tambah hanya di kanan.
    const occurrences = (text: string) => (container.textContent ?? '').split(text).length - 1;
    expect(occurrences('export default add;')).toBe(2);
    expect(occurrences('export const sub')).toBe(1);
    expect(screen.getByRole('button', { name: copy.review.commentLine(2) })).toBeInTheDocument();
  });

  it('tidak ada perubahan: pesan kosong; Terima dinonaktifkan, Tolak tetap tersedia', async () => {
    workerApi.reviewGet.mockResolvedValue(state({ files: [], checkpoints: [] }));
    await renderScreen(<DiffPanel />);

    expect(await screen.findByText(copy.review.noChanges)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: copy.review.accept })).toBeDisabled();
    expect(screen.getByRole('button', { name: copy.review.reject })).toBeEnabled();
  });

  it('worker lokal belum tersambung: keadaan offline dengan penjelasan, tanpa membaca diff', async () => {
    setWorker({ local: 'off', status: null });
    await renderScreen(<DiffPanel />);

    expect(await screen.findByText(copy.review.workerOffline)).toBeInTheDocument();
    expect(workerApi.reviewGet).not.toHaveBeenCalled();
  });

  it('galat membaca diff: pesan dari kode galat worker dan tombol coba lagi', async () => {
    workerApi.reviewGet.mockRejectedValueOnce(new WorkerCallError('review_not_found', 'x'));
    const user = userEvent.setup();
    await renderScreen(<DiffPanel />);

    expect(await screen.findByText(copy.workerErrors.review_not_found)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: copy.review.retry }));

    expect(await screen.findByRole('article', { name: 'math.js' })).toBeInTheDocument();
  });
});

describe('Tinjau perubahan: komentar per baris', () => {
  it('komentar pada baris dikirim sebagai tolak dengan path, baris, dan isi; panel menutup', async () => {
    api.reviewRun.mockResolvedValue({ ...accepted, revisionRunId: uid() });
    const user = userEvent.setup();
    await open();

    expect(screen.getByRole('button', { name: copy.review.sendComments(0) })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: copy.review.commentLine(3) }));
    await user.type(
      screen.getByRole('textbox', { name: copy.review.commentLabel('math.js', 3) }),
      'Pakai Math.imul{Control>}{Enter}{/Control}',
    );

    expect(screen.getByText('Pakai Math.imul')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: copy.review.sendComments(1) })).toBeEnabled();
    expect(screen.getAllByText(/^1$/).length).toBeGreaterThan(0); // jumlah komentar di daftar file

    await user.click(screen.getByRole('button', { name: copy.review.sendComments(1) }));

    expect(api.reviewRun).toHaveBeenCalledWith(RUN, {
      decision: 'reject',
      comments: [{ path: 'math.js', line: 3, body: 'Pakai Math.imul' }],
    });
    await waitFor(() => expect(useUiStore.getState().reviewRunId).toBeNull());
    expect(await screen.findByText(copy.review.commentsSent)).toBeInTheDocument();
    expect(useUiStore.getState().activeRunBranch).toBe('aios/abcd1234');
  });

  it('komentar bisa diubah dan dihapus sebelum dikirim; komentar kosong tidak bisa disimpan', async () => {
    const user = userEvent.setup();
    await open();

    await user.click(screen.getByRole('button', { name: copy.review.commentLine(2) }));
    expect(screen.getByRole('button', { name: copy.review.commentSave })).toBeDisabled();
    await user.type(
      screen.getByRole('textbox', { name: copy.review.commentLabel('math.js', 2) }),
      'satu',
    );
    await user.click(screen.getByRole('button', { name: copy.review.commentSave }));
    await user.click(screen.getByRole('button', { name: copy.review.commentEdit }));
    const field = screen.getByRole('textbox', { name: copy.review.commentLabel('math.js', 2) });
    expect(field).toHaveValue('satu');
    await user.type(field, ' dua');
    await user.click(screen.getByRole('button', { name: copy.review.commentSave }));
    expect(screen.getByText('satu dua')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: copy.review.commentRemove }));

    expect(screen.queryByText('satu dua')).toBeNull();
    expect(screen.getByRole('button', { name: copy.review.sendComments(0) })).toBeDisabled();
  });

  it('Esc membatalkan penyunting tanpa menyimpan', async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('button', { name: copy.review.commentLine(2) }));

    await user.type(
      screen.getByRole('textbox', { name: copy.review.commentLabel('math.js', 2) }),
      'x{Escape}',
    );

    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('button', { name: copy.review.sendComments(0) })).toBeDisabled();
  });
});

describe('Tinjau perubahan: terima dan tolak', () => {
  it('Terima: pesan commit usulan agent bisa diubah; tanpa merge secara bawaan', async () => {
    api.reviewRun.mockResolvedValue(accepted);
    const user = userEvent.setup();
    await open();

    await user.click(screen.getByRole('button', { name: copy.review.accept }));
    const dialog = await screen.findByRole('dialog', { name: copy.review.acceptTitle });
    const message = within(dialog).getByRole('textbox', { name: copy.review.commitMessage });
    expect(message).toHaveValue('feat: tambah sub dan mul');
    expect(within(dialog).getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    await user.clear(message);
    await user.type(message, 'feat(math): tambah sub');
    await user.click(within(dialog).getByRole('button', { name: copy.review.accept }));

    expect(api.reviewRun).toHaveBeenCalledWith(RUN, {
      decision: 'accept',
      merge: false,
      commitMessage: 'feat(math): tambah sub',
    });
    expect(
      await screen.findByText(copy.review.acceptedBranch('aios/abcd1234')),
    ).toBeInTheDocument();
    await waitFor(() => expect(useUiStore.getState().reviewRunId).toBeNull());
  });

  it('Terima + gabungkan ke branch kerja; hasil digabung dan merge dilewati dilaporkan jelas', async () => {
    api.reviewRun.mockResolvedValueOnce({ ...accepted, merged: true });
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('button', { name: copy.review.accept }));
    const dialog = await screen.findByRole('dialog', { name: copy.review.acceptTitle });
    await user.click(within(dialog).getByRole('switch'));
    await user.click(within(dialog).getByRole('button', { name: copy.review.accept }));

    expect(api.reviewRun).toHaveBeenLastCalledWith(RUN, {
      decision: 'accept',
      merge: true,
      commitMessage: 'feat: tambah sub dan mul',
    });
    expect(await screen.findByText(copy.review.acceptedMerged('main'))).toBeInTheDocument();
  });

  it('merge dilewati: alasan ditampilkan bersama lokasi branch', async () => {
    api.reviewRun.mockResolvedValue({ ...accepted, mergeSkipped: 'dirty' });
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('button', { name: copy.review.accept }));
    const dialog = await screen.findByRole('dialog', { name: copy.review.acceptTitle });
    await user.click(within(dialog).getByRole('switch'));
    await user.click(within(dialog).getByRole('button', { name: copy.review.accept }));

    expect(
      await screen.findByText(
        `${copy.review.mergeSkipped.dirty} ${copy.review.acceptedBranch('aios/abcd1234')}`,
      ),
    ).toBeInTheDocument();
  });

  it('repo detached HEAD: pilihan merge dinonaktifkan; pesan commit kosong tidak bisa dikirim', async () => {
    workerApi.reviewGet.mockResolvedValue(state({ targetBranch: null }));
    const user = userEvent.setup();
    await open();

    await user.click(screen.getByRole('button', { name: copy.review.accept }));
    const dialog = await screen.findByRole('dialog', { name: copy.review.acceptTitle });
    expect(within(dialog).getByRole('switch')).toBeDisabled();
    await user.clear(within(dialog).getByRole('textbox', { name: copy.review.commitMessage }));

    expect(within(dialog).getByText(copy.review.commitMessageRequired)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: copy.review.accept })).toBeDisabled();
  });

  it('Tolak semua: meminta konfirmasi dulu, lalu membuang', async () => {
    api.reviewRun.mockResolvedValue({ ...accepted, commit: null });
    const user = userEvent.setup();
    await open();

    await user.click(screen.getByRole('button', { name: copy.review.reject }));
    expect(api.reviewRun).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog', { name: copy.review.rejectTitle });
    await user.click(within(dialog).getByRole('button', { name: copy.review.rejectConfirm }));

    expect(api.reviewRun).toHaveBeenCalledWith(RUN, { decision: 'reject' });
    expect(await screen.findByText(copy.review.rejected)).toBeInTheDocument();
  });

  it('keputusan gagal: pesan galat dengan langkah berikutnya; panel dan komentar tetap', async () => {
    api.reviewRun.mockRejectedValue(new ApiProblem(503, 'worker_offline', 'x'));
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('button', { name: copy.review.accept }));
    const dialog = await screen.findByRole('dialog', { name: copy.review.acceptTitle });
    await user.click(within(dialog).getByRole('button', { name: copy.review.accept }));

    expect(await screen.findByText(copy.review.workerOffline)).toBeInTheDocument();
    expect(useUiStore.getState().reviewRunId).toBe(RUN);
    expect(screen.getByRole('dialog', { name: copy.review.acceptTitle })).toBeInTheDocument();
  });

  it('galat dari worker saat menerapkan: detail ditampilkan', async () => {
    api.reviewRun.mockRejectedValue(
      new ApiProblem(409, 'review_failed', 'Hasil run ini sudah tidak ada.'),
    );
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('button', { name: copy.review.reject }));
    const dialog = await screen.findByRole('dialog', { name: copy.review.rejectTitle });
    await user.click(within(dialog).getByRole('button', { name: copy.review.rejectConfirm }));

    expect(
      await screen.findByText(`${copy.review.failed} Hasil run ini sudah tidak ada.`),
    ).toBeInTheDocument();
  });
});

describe('Tinjau perubahan: batalkan file dan checkpoint', () => {
  it('batalkan satu file: konfirmasi, lalu daftar diperbarui dari jawaban worker; komentar dibuang', async () => {
    const after = state({ files: [state().files[1]!], checkpoints: [] });
    workerApi.reviewRevertFile.mockResolvedValue(after);
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('button', { name: copy.review.commentLine(2) }));
    await user.type(
      screen.getByRole('textbox', { name: copy.review.commentLabel('math.js', 2) }),
      'x',
    );
    await user.click(screen.getByRole('button', { name: copy.review.commentSave }));

    const article = screen.getByRole('article', { name: 'math.js' });
    await user.click(within(article).getByRole('button', { name: copy.review.revertFile }));
    const dialog = await screen.findByRole('dialog', { name: copy.review.revertConfirmTitle });
    expect(within(dialog).getByText(copy.review.revertConfirmBody('math.js'))).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: copy.review.revertConfirm }));

    expect(workerApi.reviewRevertFile).toHaveBeenCalledWith(RUN, 'math.js');
    await waitFor(() => expect(screen.queryByRole('article', { name: 'math.js' })).toBeNull());
    expect(screen.getByRole('button', { name: copy.review.sendComments(0) })).toBeDisabled();
  });

  it('tab Checkpoint: daftar terbaru dulu plus titik awal; kembali ke checkpoint memerlukan konfirmasi', async () => {
    const restored = state({ checkpoints: [{ id: SHA_1, label: 'write math.js', ts: TS }] });
    workerApi.reviewUndo.mockResolvedValue(restored);
    const user = userEvent.setup();
    await open();

    await user.click(screen.getByRole('tab', { name: new RegExp(copy.review.tabs.checkpoints) }));
    const list = await screen.findByRole('list', { name: copy.review.checkpoints.listLabel });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      expect.stringContaining('edit math.js') as string,
      expect.stringContaining('write math.js') as string,
      expect.stringContaining(copy.review.checkpoints.base) as string,
    ]);
    await user.click(
      within(list).getByRole('button', {
        name: `${copy.review.checkpoints.restore}: write math.js`,
      }),
    );
    expect(workerApi.reviewUndo).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog', {
      name: copy.review.checkpoints.confirmTitle,
    });
    await user.click(within(dialog).getByRole('button', { name: copy.review.checkpoints.confirm }));

    expect(workerApi.reviewUndo).toHaveBeenCalledWith(RUN, SHA_1);
    expect(await screen.findByText(copy.review.checkpoints.restored)).toBeInTheDocument();
  });

  it('kembali ke titik awal memakai id "base"; tanpa checkpoint: petunjuk', async () => {
    workerApi.reviewUndo.mockResolvedValue(state({ files: [], checkpoints: [] }));
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('tab', { name: new RegExp(copy.review.tabs.checkpoints) }));
    await user.click(
      await screen.findByRole('button', {
        name: `${copy.review.checkpoints.restore}: ${copy.review.checkpoints.base}`,
      }),
    );
    const dialog = await screen.findByRole('dialog', {
      name: copy.review.checkpoints.confirmTitle,
    });
    await user.click(within(dialog).getByRole('button', { name: copy.review.checkpoints.confirm }));

    expect(workerApi.reviewUndo).toHaveBeenCalledWith(RUN, 'base');
    expect(await screen.findByText(copy.review.checkpoints.empty)).toBeInTheDocument();
  });

  it('operasi worker gagal: toast galat dari kode worker', async () => {
    workerApi.reviewUndo.mockRejectedValue(new WorkerCallError('run_active', 'x'));
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('tab', { name: new RegExp(copy.review.tabs.checkpoints) }));
    await user.click(
      await screen.findByRole('button', {
        name: `${copy.review.checkpoints.restore}: edit math.js`,
      }),
    );
    const dialog = await screen.findByRole('dialog', {
      name: copy.review.checkpoints.confirmTitle,
    });
    await user.click(within(dialog).getByRole('button', { name: copy.review.checkpoints.confirm }));

    expect(await screen.findByText(copy.workerErrors.run_active)).toBeInTheDocument();
  });
});

describe('Tinjau perubahan: pendapat kedua', () => {
  const opinion = {
    model: 'peninjau',
    summary: 'Ada satu risiko.',
    findings: [
      { path: 'math.js', line: 2, severity: 'warning' as const, body: 'Tidak ada tes.' },
      { path: 'math.js', line: 3, severity: 'bug' as const, body: 'mul tidak menangani NaN.' },
      { path: 'math.js', line: null, severity: 'info' as const, body: 'Pertimbangkan TypeScript.' },
    ],
    truncated: false,
  };

  beforeEach(() => {
    api.listModels.mockResolvedValue([
      { id: 'peninjau', label: 'Peninjau', kind: 'model', ownedBy: 'x' },
    ]);
  });

  it('mengirim patch tanpa file biner, menampilkan temuan, dan menjadikannya komentar', async () => {
    api.reviewOpinion.mockResolvedValue(opinion);
    const user = userEvent.setup();
    await open();

    await user.click(await screen.findByRole('button', { name: copy.review.opinion.ask }));
    expect(api.reviewOpinion).toHaveBeenCalledWith({
      model: 'peninjau',
      files: [{ path: 'math.js', patch: PATCH_MATH }],
    });

    const list = await screen.findByRole('list', { name: copy.review.opinion.findings });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText('Ada satu risiko.')).toBeInTheDocument();
    expect(screen.getByText(copy.review.opinion.reviewedBy('peninjau'))).toBeInTheDocument();

    // Satu temuan menjadi komentar; sisanya yang punya baris ditawarkan "semua".
    await user.click(
      screen.getByRole('button', { name: `${copy.review.opinion.addComment}: math.js:2` }),
    );
    expect(
      screen.getByRole('button', { name: `${copy.review.opinion.added}: math.js:2` }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: copy.review.sendComments(1) })).toBeEnabled();

    // Temuan tanpa nomor baris tidak bisa jadi komentar.
    expect(within(list).getAllByRole('button')).toHaveLength(2);
  });

  it('galat dari gateway tampil sebagai pesan, dan tombol bisa dicoba lagi', async () => {
    api.reviewOpinion.mockRejectedValueOnce(new ApiProblem(502, 'opinion_failed', 'provider mati'));
    api.reviewOpinion.mockResolvedValue({ ...opinion, findings: [], summary: '' });
    const user = userEvent.setup();
    await open();

    await user.click(await screen.findByRole('button', { name: copy.review.opinion.ask }));
    expect(await screen.findByRole('alert')).toHaveTextContent(copy.errors.server);

    await user.click(screen.getByRole('button', { name: copy.review.opinion.ask }));
    expect(await screen.findByText(copy.review.opinion.clean)).toBeInTheDocument();
  });

  it('tanpa model yang tersedia: pesan, tanpa memanggil gateway', async () => {
    api.listModels.mockResolvedValue([]);
    const user = userEvent.setup();
    await open();
    await user.click(await screen.findByRole('button', { name: copy.review.opinion.ask }));
    expect(await screen.findByText(copy.review.opinion.noModel)).toBeInTheDocument();
    expect(api.reviewOpinion).not.toHaveBeenCalled();
  });
});

describe('Tinjau perubahan: aksi keadaan kosong', () => {
  it('tanpa run: tombol Buka papan kartu menuju /kanban', async () => {
    useUiStore.getState().setReviewRunId(null);
    const user = userEvent.setup();
    const { router } = await renderScreen(<DiffPanel />);
    await user.click(await screen.findByRole('button', { name: copy.review.openKanban }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/kanban'));
  });

  it('tidak ada perubahan: tombol Muat ulang membaca tinjauan lagi', async () => {
    workerApi.reviewGet.mockResolvedValue(state({ files: [], checkpoints: [] }));
    const user = userEvent.setup();
    await renderScreen(<DiffPanel />);
    await user.click(await screen.findByRole('button', { name: copy.review.refresh }));
    await waitFor(() => expect(workerApi.reviewGet).toHaveBeenCalledTimes(2));
  });

  it('tanpa checkpoint: tombol Muat ulang di tab Checkpoint membaca tinjauan lagi', async () => {
    workerApi.reviewGet.mockResolvedValue(state({ checkpoints: [] }));
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('tab', { name: new RegExp(copy.review.tabs.checkpoints) }));
    await screen.findByText(copy.review.checkpoints.empty);
    await user.click(screen.getByRole('button', { name: copy.review.refresh }));
    await waitFor(() => expect(workerApi.reviewGet).toHaveBeenCalledTimes(2));
  });
});
