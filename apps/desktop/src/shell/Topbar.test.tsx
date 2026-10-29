import type { Project } from '@aios/contracts';
import type { ConnectionState } from '../realtime/client';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../copy';
import { useUiStore } from '../state/uiStore';
import { api, fakeRealtime, resetApi } from '../test/fakeServices';
import { models } from '../test/fixtures';
import { renderScreen } from '../test/render';

vi.mock('../app/services', async () => (await import('../test/fakeServices')).fakeServices);

const { Topbar } = await import('./Topbar');
const { ConnectionBanner } = await import('./ConnectionBanner');

const project = {
  id: '0192f0c4-7a1b-7c2d-a001-4a5b6c7d8e91',
  name: 'Toko Online',
  workerDeviceId: '0192f0c4-7a1b-7c2d-a003-4a5b6c7d8e93',
  stack: { languages: [], frameworks: [] },
  defaultBranch: 'main',
  instructions: '',
  createdAt: '2026-10-22T06:38:00Z',
  updatedAt: '2026-10-22T06:38:00Z',
} satisfies Project;

const connect = (state: ConnectionState) =>
  vi.spyOn(fakeRealtime, 'getState').mockReturnValue(state as never);
const setOnline = (value: boolean) =>
  Object.defineProperty(navigator, 'onLine', { value, configurable: true });

beforeEach(() => {
  resetApi();
  useUiStore.setState(useUiStore.getInitialState(), true);
  api.listProjects.mockResolvedValue([project]);
  api.listModels.mockResolvedValue(models);
  setOnline(true);
});
afterEach(() => vi.restoreAllMocks());

const renderTopbar = (over: Partial<Parameters<typeof Topbar>[0]> = {}) =>
  renderScreen(
    <Topbar
      title="Chat"
      chat
      rightPanelOpen={false}
      onToggleRightPanel={() => undefined}
      {...over}
    />,
  );

describe('Topbar', () => {
  it('judul layar adalah h1; aksi konteks dan tombol panel kanan ada di kanan', async () => {
    const onSelect = vi.fn();
    const onToggle = vi.fn();
    const user = userEvent.setup();
    await renderTopbar({
      title: 'Riset',
      chat: false,
      action: { label: 'Riset baru', onSelect },
      onToggleRightPanel: onToggle,
    });

    expect(screen.getByRole('heading', { level: 1, name: 'Riset' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Riset baru' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: copy.shell.toggleRightPanel }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('tombol panel kanan menandai keadaan lewat aria-pressed', async () => {
    await renderTopbar({ rightPanelOpen: true });
    expect(screen.getByRole('button', { name: copy.shell.toggleRightPanel })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('layar chat: project aktif dan model terlihat; tanpa pilihan memakai teks bawaan', async () => {
    await renderTopbar();
    expect(await screen.findByText(copy.status.project)).toBeInTheDocument();
    expect(screen.getByText(copy.status.model)).toBeInTheDocument();
  });

  it('layar chat dengan project dan model terpilih menampilkan namanya', async () => {
    useUiStore.setState({ activeProjectId: project.id, model: 'combo/fast' });
    await renderTopbar();

    expect(await screen.findByText('Toko Online')).toBeInTheDocument();
    expect(await screen.findByText('Cepat')).toBeInTheDocument();
  });

  it('layar lain: tidak ada project dan model', async () => {
    await renderTopbar({ title: 'Kanban', chat: false });
    expect(screen.queryByText(copy.status.project)).not.toBeInTheDocument();
    expect(screen.queryByText(copy.status.model)).not.toBeInTheDocument();
  });

  it.each([
    [{ kind: 'connected' } as const, true, 'connected', copy.status.connected],
    [{ kind: 'reconnecting', attempt: 1 } as const, true, 'pending', copy.status.reconnecting],
    [{ kind: 'connecting' } as const, true, 'pending', copy.status.connecting],
    [{ kind: 'idle' } as const, true, 'lost', copy.status.idle],
    [{ kind: 'connected' } as const, false, 'lost', copy.status.offline],
  ])(
    'indikator koneksi %j online=%s: teks dan penanda status "%s"',
    async (state, online, tone, text) => {
      connect(state);
      setOnline(online);
      await renderTopbar();

      const status = screen.getByRole('status');
      expect(status).toHaveTextContent(text);
      expect(status).toHaveAttribute('data-connection', tone);
      // Titik berwarna hanya hiasan; teks yang menyampaikan arti.
      expect(status.querySelector('[aria-hidden="true"]')).not.toBeNull();
    },
  );
});

describe('ConnectionBanner (state shell: sukses, galat gateway, luring)', () => {
  it('tersambung: tidak ada banner', async () => {
    connect({ kind: 'connected' });
    await renderScreen(<ConnectionBanner />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('gateway tidak terjangkau saat online: banner galat dengan Coba lagi yang menyambung ulang seketika', async () => {
    connect({ kind: 'reconnecting', attempt: 3 });
    const user = userEvent.setup();
    await renderScreen(<ConnectionBanner />);

    expect(screen.getByRole('alert')).toHaveTextContent(copy.shell.gatewayError);
    await user.click(screen.getByRole('button', { name: copy.states.retry }));
    expect(fakeRealtime.reconnectNow).toHaveBeenCalledTimes(1);
  });

  it('luring: banner informasi tanpa tombol (tidak ada yang bisa dicoba)', async () => {
    connect({ kind: 'reconnecting', attempt: 1 });
    setOnline(false);
    await renderScreen(<ConnectionBanner />);

    expect(screen.getByRole('status')).toHaveTextContent(copy.shell.offlineBanner);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('menyambung pertama kali (connecting) atau belum mulai (idle): tidak mengganggu dengan banner', async () => {
    connect({ kind: 'connecting' });
    const view = await renderScreen(<ConnectionBanner />);
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    view.unmount();

    connect({ kind: 'idle' });
    await renderScreen(<ConnectionBanner />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
