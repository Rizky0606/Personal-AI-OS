import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../copy';
import { newLiveRun, reduceLiveRun } from '../realtime/liveRun';
import { api, emptyProgress, resetApi } from '../test/fakeServices';
import { message, run, RUN_1, RUN_2 } from '../test/fixtures';
import { renderScreen } from '../test/render';

vi.mock('../app/services', async () => (await import('../test/fakeServices')).fakeServices);

const { MessageList } = await import('./MessageList');

beforeEach(() => resetApi());

const ui = copy.runActivity.ui;
const list = (
  messages: ReturnType<typeof message>[],
  extra: Partial<Parameters<typeof MessageList>[0]> = {},
) => (
  <MessageList
    messages={messages}
    live={undefined}
    now={0}
    failure={null}
    pending={null}
    roles={[]}
    approvals={[]}
    resolvingApprovals={new Set()}
    onResolveApproval={() => undefined}
    hasMore={false}
    loadingOlder={false}
    onLoadOlder={() => undefined}
    editableUserId={null}
    {...extra}
  />
);

const withTool = (runId: string | null) =>
  message({
    author: 'assistant',
    runId,
    parts: [
      { type: 'tool', toolCallId: 't1', name: 'read_file', status: 'ok', durationMs: 340 },
      { type: 'tool', toolCallId: 't2', name: 'terminal', status: 'ok', durationMs: 900 },
      { type: 'text', text: 'Sudah beres.' },
    ],
  });

describe('MessageList: baris aktivitas jawaban', () => {
  it('jawaban lama dengan langkah tool: ringkasan terlipat dengan durasi dari waktu run yang tersimpan', async () => {
    api.getRun.mockResolvedValue(
      run({
        id: RUN_1,
        status: 'completed',
        createdAt: '2026-11-02T10:00:00Z',
        updatedAt: '2026-11-02T10:00:05Z',
      }),
    );
    await renderScreen(list([withTool(RUN_1)]));

    const row = await screen.findByRole('button', { name: ui.toggle });
    expect(await screen.findByText('Selesai · 5 dtk · 2 langkah')).toBeInTheDocument();
    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(api.getRun).toHaveBeenCalledWith(RUN_1);
    expect(screen.getByTestId('agent-orb')).toHaveAttribute('data-state', 'done');
  });

  it('server tidak memberi data run: hanya jumlah langkah, tanpa durasi karangan', async () => {
    api.getRun.mockRejectedValue(new Error('x'));
    await renderScreen(list([withTool(RUN_1)]));

    expect(await screen.findByText('Selesai · 2 langkah')).toBeInTheDocument();
  });

  it('run gagal: Orb error dan ringkasan Gagal', async () => {
    api.getRun.mockResolvedValue(
      run({
        id: RUN_1,
        status: 'failed',
        createdAt: '2026-11-02T10:00:00Z',
        updatedAt: '2026-11-02T10:00:03Z',
      }),
    );
    await renderScreen(list([withTool(RUN_1)]));

    expect(await screen.findByText('Gagal · 3 dtk · 2 langkah')).toBeInTheDocument();
    expect(screen.getByTestId('agent-orb')).toHaveAttribute('data-state', 'error');
  });

  it('jawaban teks biasa tanpa langkah tool: tanpa baris aktivitas dan tanpa mengambil run', async () => {
    await renderScreen(list([message({ author: 'assistant', runId: RUN_1, text: 'Halo.' })]));

    expect(await screen.findByText('Halo.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: ui.toggle })).not.toBeInTheDocument();
    expect(api.getRun).not.toHaveBeenCalled();
    expect(screen.getByTestId('agent-orb')).toHaveAttribute('data-state', 'done');
  });

  it('jawaban lama tanpa langkah tool tetapi dengan berkas hasil: thumbnail gambar dari agregat progress, SVG sebagai berkas', async () => {
    const file = (
      kind: 'image' | 'file',
      fileId: string,
      name: string,
      mime: string,
      runId = RUN_1,
    ) => ({
      kind,
      runId,
      at: '2026-10-24T00:00:00.000Z',
      fileId,
      name,
      mime,
      size: 9,
    });
    api.getConversationProgress.mockResolvedValue({
      ...emptyProgress(),
      outputs: [
        file('image', '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e31', 'layar.png', 'image/png'),
        file('file', '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e32', 'diagram.svg', 'image/svg+xml'),
        // Berkas dari run lain tidak ikut di jawaban ini.
        file('image', '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e33', 'lain.png', 'image/png', RUN_2),
      ],
    });
    await renderScreen(
      list([message({ author: 'assistant', runId: RUN_1, text: 'Sudah kuambil.' })]),
    );

    const png = await screen.findByRole('button', { name: 'Preview: layar.png' });
    await waitFor(() => expect(png.querySelector('img')).not.toBeNull());
    const svg = screen.getByRole('button', { name: 'Preview: diagram.svg' });
    expect(svg.querySelector('img')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Preview: lain.png' })).not.toBeInTheDocument();
    // Hanya gambar raster yang diunduh untuk thumbnail; SVG tidak.
    expect(api.downloadFile).toHaveBeenCalledWith('0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e31');
    expect(api.downloadFile).not.toHaveBeenCalledWith('0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e32');
  });

  it('run yang baru selesai di sesi ini memakai jejak aslinya (waktu nyata, bukan perkiraan)', async () => {
    let finished = newLiveRun(RUN_1);
    finished = reduceLiveRun(
      finished,
      { type: 'tool.started', toolCallId: 'a', name: 'bash', target: 'pnpm test' },
      Date.parse('2026-11-02T10:00:01Z'),
    );
    finished = reduceLiveRun(
      finished,
      { type: 'tool.finished', toolCallId: 'a', status: 'ok', durationMs: 4000 },
      Date.parse('2026-11-02T10:00:05Z'),
    );
    finished = reduceLiveRun(
      finished,
      { type: 'run.completed', summary: 'ok' },
      Date.parse('2026-11-02T10:00:07Z'),
    );
    finished = reduceLiveRun(
      finished,
      { type: 'run.status', status: 'completed' },
      Date.parse('2026-11-02T10:00:07Z'),
    );
    await renderScreen(
      list([message({ author: 'assistant', runId: RUN_1, text: 'Selesai.' })], {
        finished,
        now: Date.parse('2026-11-02T10:01:00Z'),
      }),
    );

    expect(await screen.findByText('Selesai · 6 dtk · 1 langkah')).toBeInTheDocument();
    // Jejak sudah ada: tidak perlu mengambil run dari server.
    expect(api.getRun).not.toHaveBeenCalled();
  });

  it('run berjalan: baris aktivitas hidup di dalam jawaban live dengan Orb mengikuti fase', async () => {
    let live = newLiveRun(RUN_1);
    live = reduceLiveRun(
      live,
      { type: 'run.status', status: 'running' },
      Date.parse('2026-11-02T10:00:00Z'),
    );
    live = reduceLiveRun(
      live,
      { type: 'tool.started', toolCallId: 'a', name: 'terminal', target: 'pnpm test' },
      Date.parse('2026-11-02T10:00:02Z'),
    );
    await renderScreen(list([], { live, now: Date.parse('2026-11-02T10:00:09Z') }));

    const row = await screen.findByRole('button', { name: ui.toggle });
    expect(row).toHaveTextContent('Menjalankan perintah');
    expect(row).toHaveTextContent('pnpm test');
    expect(row).toHaveTextContent('9 dtk');
    expect(screen.getByTestId('agent-orb')).toHaveAttribute('data-state', 'tool');
    // Baris status lama di bawah jawaban sudah digantikan baris aktivitas.
    expect(screen.queryByText(`${copy.runStatus.running}…`)).not.toBeInTheDocument();
  });
});
