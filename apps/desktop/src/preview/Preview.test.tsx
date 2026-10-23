import type { PreviewInfo } from '@aios/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../copy';
import { useUiStore } from '../state/uiStore';
import { emitPush, resetApi, setWorker, workerApi } from '../test/fakeServices';
import { renderScreen } from '../test/render';
import { WorkerCallError } from '../worker/localClient';

const openExternal = vi.hoisted(() => vi.fn());
vi.mock('../lib/external', () => ({ openExternal, saveBlob: vi.fn() }));
vi.mock('../app/services', async () => (await import('../test/fakeServices')).fakeServices);

const { PreviewPanel } = await import('./PreviewPanel');
const { Composer } = await import('../chat/Composer');

const PROJECT = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';
const RUN = '0192f0c4-7a1b-7c2d-9e3f-4a5b6c7d8e90';

function info(over: Partial<PreviewInfo> = {}): PreviewInfo {
  return {
    key: `project:${PROJECT}`,
    projectId: PROJECT,
    runId: null,
    status: 'ready',
    url: 'http://127.0.0.1:50123/',
    devUrl: 'http://localhost:5173/',
    command: 'pnpm run dev',
    error: null,
    log: '',
    ...over,
  };
}

beforeEach(() => {
  resetApi();
  openExternal.mockClear();
  setWorker({ local: 'connected', status: null });
  workerApi.previewGet.mockResolvedValue(null);
  useUiStore.setState({ activeProjectId: PROJECT, reviewRunId: null, attachments: [] });
});

const frame = () => screen.getByTitle<HTMLIFrameElement>(copy.preview.frameTitle);

/** Pesan seolah dari halaman di dalam iframe. */
function fromPage(data: unknown) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, source: frame().contentWindow }));
  });
}

describe('PreviewPanel: keadaan', () => {
  it('tanpa project aktif: mengajak memilih project', async () => {
    useUiStore.setState({ activeProjectId: null });
    await renderScreen(<PreviewPanel />);
    expect(await screen.findByText(copy.preview.noProject)).toBeInTheDocument();
  });

  it('worker lokal belum tersambung: pesan offline, tanpa memanggil worker', async () => {
    setWorker({ local: 'off', status: null });
    await renderScreen(<PreviewPanel />);

    expect(await screen.findByText(copy.preview.workerOffline)).toBeInTheDocument();
    expect(workerApi.previewGet).not.toHaveBeenCalled();
  });

  it('memuat: skeleton berlabel', async () => {
    workerApi.previewGet.mockReturnValue(new Promise(() => undefined));
    await renderScreen(<PreviewPanel />);
    expect(await screen.findByRole('status', { name: copy.preview.loading })).toBeInTheDocument();
  });

  it('belum berjalan: satu kalimat dan tombol Jalankan; mulai menampilkan keadaan menjalankan lalu halaman', async () => {
    let finish!: (value: PreviewInfo) => void;
    workerApi.previewStart.mockReturnValue(new Promise((r) => (finish = r)));
    const user = userEvent.setup();
    await renderScreen(<PreviewPanel />);

    expect(await screen.findByText(copy.preview.idleProject)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: copy.preview.start }));
    expect(workerApi.previewStart).toHaveBeenCalledWith({ projectId: PROJECT });
    expect(await screen.findByText(copy.preview.starting)).toBeInTheDocument();

    await act(() => {
      finish(info());
      return Promise.resolve();
    });
    expect(frame().getAttribute('src')).toBe('http://127.0.0.1:50123/');
  });

  it('hasil run yang ditinjau: preview memakai worktree run itu', async () => {
    useUiStore.setState({ reviewRunId: RUN });
    workerApi.previewGet.mockResolvedValue(null);
    workerApi.previewStart.mockResolvedValue(info({ runId: RUN, key: `run:${RUN}` }));
    const user = userEvent.setup();
    await renderScreen(<PreviewPanel />);

    expect(await screen.findByText(copy.preview.idleRun)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: copy.preview.start }));

    expect(workerApi.previewStart).toHaveBeenCalledWith({ projectId: PROJECT, runId: RUN });
    expect(await screen.findByText(copy.preview.target.run)).toBeInTheDocument();
  });

  it('gagal: pesan, log dev server yang bisa dibuka, dan coba lagi', async () => {
    workerApi.previewGet.mockResolvedValue(
      info({
        status: 'failed',
        url: null,
        devUrl: null,
        error: 'Dev server berhenti sebelum siap.',
        log: 'Error: port dipakai',
      }),
    );
    workerApi.previewStart.mockResolvedValue(info());
    const user = userEvent.setup();
    await renderScreen(<PreviewPanel />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Dev server berhenti sebelum siap.');
    await user.click(screen.getByText(copy.preview.showLog));
    expect(screen.getByText('Error: port dipakai')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: copy.preview.retry }));

    expect(workerApi.previewStart).toHaveBeenCalledTimes(1);
    expect(await screen.findByTitle(copy.preview.frameTitle)).toBeInTheDocument();
  });

  it('galat dari worker (mis. project belum terikat) ditampilkan sebagai pesan', async () => {
    workerApi.previewStart.mockRejectedValue(
      new WorkerCallError('preview_unavailable', 'Project ini belum terikat ke folder.'),
    );
    const user = userEvent.setup();
    await renderScreen(<PreviewPanel />);

    await user.click(await screen.findByRole('button', { name: copy.preview.start }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      copy.workerErrors.preview_unavailable,
    );
  });

  it('dorongan worker (dev server dimulai agent) langsung menampilkan halaman; berhenti kembali ke kosong', async () => {
    await renderScreen(<PreviewPanel />);
    expect(await screen.findByText(copy.preview.idleProject)).toBeInTheDocument();

    act(() => emitPush({ push: 'preview.state', preview: info() }));
    expect(await screen.findByTitle(copy.preview.frameTitle)).toBeInTheDocument();

    act(() => emitPush({ push: 'preview.state', preview: info({ status: 'stopped', url: null }) }));
    expect(await screen.findByText(copy.preview.idleProject)).toBeInTheDocument();
  });
});

describe('PreviewPanel: halaman', () => {
  beforeEach(() => {
    workerApi.previewGet.mockResolvedValue(info());
  });

  it('pilihan ukuran mengubah lebar frame: ponsel 390, tablet 768, penuh mengikuti panel', async () => {
    const user = userEvent.setup();
    await renderScreen(<PreviewPanel />);
    await screen.findByTitle(copy.preview.frameTitle);

    await user.click(screen.getByRole('button', { name: copy.preview.sizes.phone }));
    expect(frame().style.width).toBe('390px');
    await user.click(screen.getByRole('button', { name: copy.preview.sizes.tablet }));
    expect(frame().style.width).toBe('768px');
    await user.click(screen.getByRole('button', { name: copy.preview.sizes.full }));
    expect(frame().style.width).toBe('');
    expect(screen.getByRole('button', { name: copy.preview.sizes.full })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('muat ulang membuat iframe baru; buka di browser memakai alamat dev server asli', async () => {
    const user = userEvent.setup();
    await renderScreen(<PreviewPanel />);
    const before = await screen.findByTitle(copy.preview.frameTitle);

    await user.click(screen.getByRole('button', { name: copy.preview.reload }));
    expect(screen.getByTitle(copy.preview.frameTitle)).not.toBe(before);

    await user.click(screen.getByRole('button', { name: copy.preview.openBrowser }));
    expect(openExternal).toHaveBeenCalledWith('http://localhost:5173/');
  });

  it('console: pesan dari halaman tampil, error dihitung, bisa dibersihkan; pesan dari sumber lain diabaikan', async () => {
    const user = userEvent.setup();
    await renderScreen(<PreviewPanel />);
    await screen.findByTitle(copy.preview.frameTitle);
    const console_ = screen.getByRole('region', { name: copy.preview.console.title });
    expect(within(console_).getByText(copy.preview.console.empty)).toBeInTheDocument();

    fromPage({ aios: 'preview', type: 'console', level: 'log', text: 'halo' });
    fromPage({ aios: 'preview', type: 'console', level: 'error', text: 'Gagal memuat /app.js' });
    // Dari jendela lain (bukan iframe): diabaikan.
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { aios: 'preview', type: 'console', level: 'error', text: 'palsu' },
        }),
      );
    });

    expect(within(console_).getByText('halo')).toBeInTheDocument();
    expect(within(console_).getByText('Gagal memuat /app.js')).toBeInTheDocument();
    expect(within(console_).queryByText('palsu')).toBeNull();
    expect(within(console_).getByText(/1 error/)).toBeInTheDocument();

    await user.click(within(console_).getByRole('button', { name: copy.preview.console.clear }));
    expect(within(console_).getByText(copy.preview.console.empty)).toBeInTheDocument();
  });

  it('pilih elemen: mode inspeksi dikirim ke halaman; hasilnya menjadi lampiran composer dengan thumbnail', async () => {
    workerApi.previewShot.mockResolvedValue({ png: 'AAAA', width: 390, height: 700 });
    const user = userEvent.setup();
    await renderScreen(<PreviewPanel />);
    await screen.findByTitle(copy.preview.frameTitle);
    const post = vi.spyOn(frame().contentWindow!, 'postMessage');

    await user.click(screen.getByRole('button', { name: copy.preview.inspect }));
    expect(post).toHaveBeenLastCalledWith({ aios: 'preview-cmd', cmd: 'inspect', on: true }, '*');
    expect(screen.getByText(copy.preview.inspecting)).toBeInTheDocument();

    fromPage({
      aios: 'preview',
      type: 'pick',
      selector: 'button.simpan',
      html: '<button class="simpan">Simpan</button>',
      text: 'Simpan',
      styles: { width: '600px' },
      rect: { x: 0, y: 0, width: 600, height: 36 },
      viewport: { width: 390, height: 700 },
      url: 'http://127.0.0.1:50123/',
    });

    await waitFor(() => expect(useUiStore.getState().attachments).toHaveLength(1));
    expect(workerApi.previewShot).toHaveBeenCalledWith({
      projectId: PROJECT,
      selector: 'button.simpan',
      width: 390,
      height: 700,
    });
    const [attachment] = useUiStore.getState().attachments;
    expect(attachment?.thumbnail).toBe('data:image/png;base64,AAAA');
    expect(attachment?.text).toContain('Selector: button.simpan');
    expect(await screen.findByText(copy.preview.attached)).toBeInTheDocument();
  });

  it('tangkapan elemen gagal: lampiran tetap ditambahkan tanpa thumbnail', async () => {
    workerApi.previewShot.mockRejectedValue(new Error('browser tidak ada'));
    await renderScreen(<PreviewPanel />);
    await screen.findByTitle(copy.preview.frameTitle);

    fromPage({
      aios: 'preview',
      type: 'pick',
      selector: 'h1',
      html: '<h1>x</h1>',
      text: 'x',
      styles: {},
      rect: { x: 0, y: 0, width: 10, height: 10 },
      viewport: { width: 800, height: 600 },
      url: 'http://127.0.0.1:50123/',
    });

    await waitFor(() => expect(useUiStore.getState().attachments).toHaveLength(1));
    expect(useUiStore.getState().attachments[0]?.thumbnail).toBeUndefined();
  });

  it('hentikan: worker diminta berhenti dan panel kembali ke keadaan kosong', async () => {
    workerApi.previewStop.mockResolvedValue(undefined);
    const user = userEvent.setup();
    await renderScreen(<PreviewPanel />);
    await screen.findByTitle(copy.preview.frameTitle);

    await user.click(screen.getByRole('button', { name: copy.preview.stop }));

    expect(workerApi.previewStop).toHaveBeenCalledWith({ projectId: PROJECT });
    expect(await screen.findByText(copy.preview.idleProject)).toBeInTheDocument();
  });
});

describe('Composer: lampiran dari preview', () => {
  const props = {
    draft: 'perbaiki ini',
    onDraft: vi.fn(),
    onSend: vi.fn(),
    onStop: vi.fn(),
    streaming: false,
    sending: false,
    roles: [],
    role: null,
    onRole: vi.fn(),
    models: [],
    model: null,
    onModel: vi.fn(),
    canEditLast: false,
    onEditLast: vi.fn(),
    focusNonce: 0,
  };

  it('menampilkan chip lampiran dengan thumbnail; tombol hapus memanggil onRemoveAttachment', async () => {
    const remove = vi.fn();
    const user = userEvent.setup();
    await renderScreen(
      <Composer
        {...props}
        attachments={[
          {
            id: 'a1',
            label: 'button.simpan',
            text: 'konteks',
            thumbnail: 'data:image/png;base64,AAAA',
          },
        ]}
        onRemoveAttachment={remove}
      />,
    );

    const list = screen.getByRole('list', { name: copy.preview.attachment.group });
    expect(within(list).getByText('button.simpan')).toBeInTheDocument();
    await user.click(
      within(list).getByRole('button', { name: copy.preview.attachment.remove('button.simpan') }),
    );
    expect(remove).toHaveBeenCalledWith('a1');
  });

  it('tanpa lampiran tidak ada daftar', async () => {
    await renderScreen(<Composer {...props} />);
    expect(screen.queryByRole('list', { name: copy.preview.attachment.group })).toBeNull();
  });
});
