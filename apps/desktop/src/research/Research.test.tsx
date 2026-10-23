import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResearchJobDetail } from '../api/gateway';
import { ApiProblem } from '../auth/authSession';
import { copy } from '../copy';
import { RUN_1, RUN_2, TS } from '../test/fixtures';
import { api, emit, resetApi, runs } from '../test/fakeServices';
import { renderScreen } from '../test/render';

vi.mock('../app/services', async () => (await import('../test/fakeServices')).fakeServices);
const openExternal = vi.hoisted(() => vi.fn());
const saveBlob = vi.hoisted(() => vi.fn());
vi.mock('../lib/external', () => ({ openExternal, saveBlob }));

const { ResearchDetailScreen } = await import('./ResearchDetailScreen');
const { ResearchFormScreen } = await import('./ResearchFormScreen');

const JOB = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';

function job(over: Partial<ResearchJobDetail> = {}): ResearchJobDetail {
  return {
    id: JOB,
    question: 'Bun atau Node?',
    depth: 'standard',
    status: 'running',
    plan: null,
    reportMd: null,
    runId: RUN_1,
    createdAt: TS,
    updatedAt: TS,
    sources: [],
    ...over,
  };
}

const REPORT = `# Hasil\n\nBun lebih cepat [1] tetapi Node lebih matang [2].\n\n## Daftar sumber\n\n- [1] [Benchmark Bun](https://bun.sh/blog) — bun.sh\n- [2] [Catatan Node](https://nodejs.org/en) — nodejs.org\n`;

beforeEach(() => {
  resetApi();
  openExternal.mockClear();
  saveBlob.mockClear();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});
afterEach(() => {
  runs.release(RUN_1);
  runs.release(RUN_2);
});

describe('ResearchDetailScreen', () => {
  it('skeleton saat memuat; job berjalan menampilkan tahap, kemajuan, dan sumber live', async () => {
    let resolve: (value: ResearchJobDetail) => void = () => undefined;
    api.getResearch.mockReturnValue(new Promise((r) => (resolve = r)));
    await renderScreen(<ResearchDetailScreen researchId={JOB} />);
    expect(screen.getByRole('status', { name: copy.states.loading })).toBeInTheDocument();

    resolve(job());
    expect(await screen.findByText('Bun atau Node?')).toBeInTheDocument();
    await waitFor(() => expect(runs.get(RUN_1)).toBeDefined());

    act(() => {
      emit(`run:${RUN_1}`, {
        type: 'research.progress',
        stage: 'reading',
        progress: 0.5,
        message: 'Membaca 3 halaman',
      });
      emit(`run:${RUN_1}`, {
        type: 'research.source',
        sourceId: RUN_2,
        url: 'https://bun.sh/blog',
        title: 'Blog Bun',
      });
    });

    const bar = await screen.findByRole('progressbar', { name: copy.research.progress });
    expect(bar).toHaveAttribute('aria-valuenow', '63');
    expect(screen.getByText(copy.research.stages.reading).closest('li')).toHaveAttribute(
      'aria-current',
      'step',
    );
    expect(screen.getByText('Membaca 3 halaman')).toBeInTheDocument();
    expect(screen.getByText('Blog Bun')).toBeInTheDocument();
  });

  it('laporan selesai: rujukan [n] bisa diklik dan membuka sumbernya; daftar sumber bernomor', async () => {
    api.getResearch.mockResolvedValue(job({ status: 'completed', reportMd: REPORT }));
    const user = userEvent.setup();
    await renderScreen(<ResearchDetailScreen researchId={JOB} />);

    await user.click(await screen.findByRole('link', { name: 'Rujukan 2: buka sumber' }));

    expect(openExternal).toHaveBeenCalledWith('https://nodejs.org/en');
    expect(
      screen.getByRole('link', { name: `${copy.research.openSource}: Benchmark Bun` }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('ekspor Markdown mengunduh berkas dengan nama dari id riset', async () => {
    api.getResearch.mockResolvedValue(job({ status: 'completed', reportMd: REPORT }));
    const blob = new Blob(['# Hasil']);
    api.exportResearch.mockResolvedValue(blob);
    const user = userEvent.setup();
    await renderScreen(<ResearchDetailScreen researchId={JOB} />);

    await user.click(await screen.findByRole('button', { name: copy.research.exportMd }));

    expect(api.exportResearch).toHaveBeenCalledWith(JOB, 'md');
    await waitFor(() => expect(saveBlob).toHaveBeenCalledWith(blob, `riset-${JOB.slice(0, 8)}.md`));
    expect(await screen.findByText(copy.research.exported)).toBeInTheDocument();
  });

  it('gagal ekspor menampilkan toast dengan langkah berikutnya', async () => {
    api.getResearch.mockResolvedValue(job({ status: 'completed', reportMd: REPORT }));
    api.exportResearch.mockRejectedValue(new ApiProblem(409, 'not_ready', 'x'));
    const user = userEvent.setup();
    await renderScreen(<ResearchDetailScreen researchId={JOB} />);

    await user.click(await screen.findByRole('button', { name: copy.research.exportPdf }));

    expect(await screen.findByText(new RegExp(copy.research.exportFailed))).toBeInTheDocument();
    expect(saveBlob).not.toHaveBeenCalled();
  });

  it('job berjalan bisa dibatalkan', async () => {
    api.getResearch.mockResolvedValue(job());
    api.cancelResearch.mockResolvedValue(job({ status: 'cancelled' }));
    const user = userEvent.setup();
    await renderScreen(<ResearchDetailScreen researchId={JOB} />);

    await user.click(await screen.findByRole('button', { name: copy.research.cancel }));

    expect(api.cancelResearch).toHaveBeenCalledWith(JOB);
  });

  it('job gagal menampilkan banner; tidak ditemukan menampilkan error dengan Coba lagi', async () => {
    api.getResearch.mockResolvedValueOnce(job({ status: 'failed' }));
    const view = await renderScreen(<ResearchDetailScreen researchId={JOB} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(copy.research.failedTitle);
    view.unmount();

    api.getResearch.mockRejectedValue(new ApiProblem(404, 'not_found', 'x'));
    await renderScreen(<ResearchDetailScreen researchId={JOB} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(copy.errors.notFound);
    expect(screen.getByRole('button', { name: copy.states.retry })).toBeInTheDocument();
  });

  it('offline tanpa data menampilkan keadaan offline', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    api.getResearch.mockRejectedValue(new ApiProblem(0, 'network', 'x'));
    await renderScreen(<ResearchDetailScreen researchId={JOB} />);

    expect(await screen.findByText(copy.states.offline)).toBeInTheDocument();
  });
});

describe('ResearchFormScreen', () => {
  it('pertanyaan kosong ditolak lokal; submit memanggil server dan pindah ke detail', async () => {
    api.createResearch.mockResolvedValue(job({ status: 'queued' }));
    const user = userEvent.setup();
    const { router } = await renderScreen(<ResearchFormScreen />, '/research');

    await user.click(screen.getByRole('button', { name: copy.research.form.submit }));
    expect(screen.getByText(copy.research.form.emptyQuestion)).toBeInTheDocument();
    expect(api.createResearch).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(copy.research.form.question), 'Bun atau Node?');
    await user.click(screen.getByRole('radio', { name: copy.research.form.depths.deep }));
    await user.click(screen.getByRole('button', { name: copy.research.form.submit }));

    expect(api.createResearch).toHaveBeenCalledWith('Bun atau Node?', 'deep');
    await waitFor(() => expect(router.state.location.pathname).toBe(`/research/${JOB}`));
  });
});
