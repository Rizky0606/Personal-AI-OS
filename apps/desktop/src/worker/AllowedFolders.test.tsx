import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../copy';
import { resetApi, setWorker, workerApi } from '../test/fakeServices';
import { renderScreen } from '../test/render';
import { WorkerCallError, type WorkerSnapshot } from './localClient';
import { workerIndicator } from './status';

vi.mock('../app/services', async () => (await import('../test/fakeServices')).fakeServices);
const pickFolder = vi.hoisted(() => vi.fn());
vi.mock('../lib/pickFolder', () => ({ pickFolder }));

const { AllowedFolders } = await import('./AllowedFolders');

const connected = () =>
  setWorker({
    local: 'connected',
    status: { gateway: 'connected', deviceId: null, activeRuns: 0, version: '0.1.0' },
  });

beforeEach(() => {
  resetApi();
  pickFolder.mockReset();
});

describe('AllowedFolders', () => {
  it('menampilkan folder dari worker; kosong punya kalimat dan satu tombol aksi', async () => {
    connected();
    workerApi.folders.mockResolvedValue(['C:\\Kerja', 'D:\\Proyek']);
    const view = await renderScreen(<AllowedFolders />);

    expect(await screen.findByText('C:\\Kerja')).toBeInTheDocument();
    expect(screen.getByText('D:\\Proyek')).toBeInTheDocument();
    view.unmount();

    workerApi.folders.mockResolvedValue([]);
    await renderScreen(<AllowedFolders />);
    expect(await screen.findByText(copy.settings.folders.empty)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: copy.settings.folders.add })).toHaveLength(1);
  });

  it('tambah lewat dialog folder sistem; worker yang memutuskan, hasilnya ditampilkan', async () => {
    connected();
    workerApi.folders.mockResolvedValueOnce([]).mockResolvedValue(['C:\\Kerja']);
    workerApi.addFolder.mockResolvedValue(['C:\\Kerja']);
    pickFolder.mockResolvedValue('C:\\Kerja');
    const user = userEvent.setup();
    await renderScreen(<AllowedFolders />);

    await user.click(await screen.findByRole('button', { name: copy.settings.folders.add }));

    expect(workerApi.addFolder).toHaveBeenCalledWith('C:\\Kerja');
    expect(await screen.findByText('C:\\Kerja')).toBeInTheDocument();
    expect(await screen.findByText(copy.settings.folders.added)).toBeInTheDocument();
  });

  it('dialog dibatalkan: tidak ada panggilan ke worker', async () => {
    connected();
    pickFolder.mockResolvedValue(null);
    const user = userEvent.setup();
    await renderScreen(<AllowedFolders />);

    await user.click(await screen.findByRole('button', { name: copy.settings.folders.add }));

    expect(workerApi.addFolder).not.toHaveBeenCalled();
  });

  it('penolakan worker (folder terlalu luas) tampil sebagai toast dengan langkah berikutnya', async () => {
    connected();
    workerApi.addFolder.mockRejectedValue(new WorkerCallError('path_too_broad', 'x'));
    pickFolder.mockResolvedValue('C:\\');
    const user = userEvent.setup();
    await renderScreen(<AllowedFolders />);

    await user.click(await screen.findByRole('button', { name: copy.settings.folders.add }));

    expect(await screen.findByText(copy.workerErrors.path_too_broad)).toBeInTheDocument();
  });

  it('mencabut izin folder', async () => {
    connected();
    workerApi.folders.mockResolvedValue(['C:\\Kerja']);
    workerApi.removeFolder.mockResolvedValue([]);
    const user = userEvent.setup();
    await renderScreen(<AllowedFolders />);

    await user.click(
      await screen.findByRole('button', { name: `${copy.settings.folders.remove}: C:\\Kerja` }),
    );

    expect(workerApi.removeFolder).toHaveBeenCalledWith('C:\\Kerja');
    expect(await screen.findByText(copy.settings.folders.removed)).toBeInTheDocument();
  });

  it('worker belum tersambung: keadaan offline dan tombol tambah nonaktif; pulih saat tersambung', async () => {
    workerApi.folders.mockResolvedValue(['C:\\Kerja']);
    await renderScreen(<AllowedFolders />);
    expect(await screen.findByText(copy.settings.folders.workerOff)).toBeInTheDocument();

    act(() => connected());

    expect(await screen.findByText('C:\\Kerja')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: copy.settings.folders.add })).toBeEnabled();
  });

  it('gagal memuat daftar: error dengan Coba lagi', async () => {
    connected();
    workerApi.folders.mockRejectedValueOnce(new WorkerCallError('timeout', 'x'));
    workerApi.folders.mockResolvedValue(['C:\\Kerja']);
    const user = userEvent.setup();
    await renderScreen(<AllowedFolders />);

    expect(await screen.findByRole('alert')).toHaveTextContent(copy.states.error);
    await user.click(screen.getByRole('button', { name: copy.states.retry }));

    expect(await screen.findByText('C:\\Kerja')).toBeInTheDocument();
  });
});

describe('workerIndicator', () => {
  const status = (
    gateway: 'offline' | 'connecting' | 'connected' | 'reconnecting',
    deviceId: string | null = null,
  ) => ({ gateway, deviceId, activeRuns: 0, version: 'x' }) as const;
  const at = (s: WorkerSnapshot) => workerIndicator(s);

  it('mati bila worker lokal tidak ada; menyambung ulang selama lokal belum siap', () => {
    expect(at({ local: 'off', status: null })).toBe('off');
    expect(at({ local: 'connecting', status: null })).toBe('reconnecting');
    expect(at({ local: 'reconnecting', status: null })).toBe('reconnecting');
    expect(at({ local: 'connected', status: null })).toBe('reconnecting');
  });

  it('mengikuti status gateway bila lokal tersambung', () => {
    expect(at({ local: 'connected', status: status('connected', 'd') })).toBe('connected');
    expect(at({ local: 'connected', status: status('connecting', 'd') })).toBe('reconnecting');
    expect(at({ local: 'connected', status: status('reconnecting', 'd') })).toBe('reconnecting');
  });

  it('gateway offline: sedang mendaftar (belum ada perangkat) = menyambung; sudah terdaftar tapi offline = mati', () => {
    expect(at({ local: 'connected', status: status('offline', null) })).toBe('reconnecting');
    expect(at({ local: 'connected', status: status('offline', 'd') })).toBe('off');
  });
});
