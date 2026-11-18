import type { Project } from '@aios/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../copy';
import { useUiStore } from '../state/uiStore';
import { api, resetApi, setWorker } from '../test/fakeServices';
import { models, TS } from '../test/fixtures';
import { renderScreen } from '../test/render';

vi.mock('../app/services', async () => (await import('../test/fakeServices')).fakeServices);

const { SidebarStatus } = await import('./SidebarStatus');

beforeEach(() => {
  resetApi();
  useUiStore.setState(useUiStore.getInitialState(), true);
  api.listModels.mockResolvedValue(models);
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

describe('SidebarStatus: kuota', () => {
  it('tanpa data kuota (galat atau kosong): baris kuota tidak tampil, bukan "Kuota 0 token"', async () => {
    api.getQuota.mockRejectedValue(new Error('x'));
    await renderScreen(<SidebarStatus />);

    expect(screen.queryByRole('link', { name: /Kuota/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Kuota/)).not.toBeInTheDocument();
    // Status lain tetap ada.
    expect(screen.getByText(copy.status.idle)).toBeInTheDocument();
  });

  it('data ada tetapi nol token: baris kuota tidak tampil', async () => {
    api.getQuota.mockResolvedValue({
      source: 'runs',
      totals: { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
      byModel: [],
      byDay: [],
    });
    await renderScreen(<SidebarStatus />);
    await waitFor(() => expect(api.getQuota).toHaveBeenCalled());
    expect(screen.queryByText(/Kuota/)).not.toBeInTheDocument();
  });

  it('ada token tetapi biaya 0 atau tak tersedia: hanya token, tanpa "$0,00"', async () => {
    api.getQuota.mockResolvedValue({
      source: 'runs',
      totals: { requests: 5, inputTokens: 12_000, outputTokens: 300, costUsd: 0 },
      byModel: [],
      byDay: [],
    });
    await renderScreen(<SidebarStatus />);

    const link = await screen.findByRole('link', { name: copy.status.quotaTokens('12,3 rb') });
    expect(link).toHaveTextContent('Kuota 12,3 rb token');
    expect(link).not.toHaveTextContent('$');
  });

  it('ada token dan biaya di atas 0: ringkasan memuat biaya', async () => {
    api.getQuota.mockResolvedValue({
      source: 'ninerouter',
      totals: { requests: 5, inputTokens: 12_000, outputTokens: 300, costUsd: 0.5 },
      byModel: [],
      byDay: [],
    });
    await renderScreen(<SidebarStatus />);

    expect(
      await screen.findByText(copy.status.quotaSummary('12,3 rb', '$0,50')),
    ).toBeInTheDocument();
  });

  it('sidebar ringkas: ikon kuota ikut disembunyikan tanpa data token, dan tampil dengan nama lengkap bila ada', async () => {
    api.getQuota.mockRejectedValue(new Error('x'));
    const view = await renderScreen(<SidebarStatus collapsed />);
    expect(screen.queryByRole('link', { name: /Kuota/ })).not.toBeInTheDocument();
    view.unmount();

    api.getQuota.mockResolvedValue({
      source: 'runs',
      totals: { requests: 1, inputTokens: 1_500, outputTokens: 0, costUsd: 0 },
      byModel: [],
      byDay: [],
    });
    await renderScreen(<SidebarStatus collapsed />);
    expect(await screen.findByRole('link', { name: /Kuota 1,5 rb token/ })).toBeInTheDocument();
  });
});

describe('SidebarStatus: worker project menurut gateway', () => {
  const OWN = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';
  const OLD = '0192f0c4-7a1b-7c2d-9e3f-4a5b6c7d8e90';
  const PROJECT = '0192f0c4-7a1b-7c2d-a001-4a5b6c7d8e91';
  const status = (
    over: { workerDeviceId?: string; name?: string; online?: boolean; revoked?: boolean } = {},
  ) => ({
    workerDeviceId: OWN,
    name: 'PC-RUMAH',
    online: true,
    revoked: false,
    lastSeenAt: TS,
    ...over,
  });
  const project: Project = {
    id: PROJECT,
    name: 'ts-lib',
    workerDeviceId: OWN,
    stack: { languages: ['typescript'], frameworks: [] },
    defaultBranch: 'main',
    instructions: '',
    createdAt: TS,
    updatedAt: TS,
  };
  const card = () => screen.getByRole('status', { name: /worker/i });

  beforeEach(() => {
    api.getQuota.mockRejectedValue(new Error('x'));
    // Worker PC ini tersambung ke gateway sebagai perangkat OWN.
    setWorker({
      local: 'connected',
      status: {
        gateway: 'connected',
        deviceId: OWN,
        activeRuns: 0,
        version: '0.1.0',
        ompVersion: null,
        browserAvailable: false,
      },
    });
  });

  it('tanpa project aktif: status worker lokal, gateway tidak ditanya', async () => {
    await renderScreen(<SidebarStatus />);
    expect(card()).toHaveAccessibleName(copy.workerStatus.connected);
    expect(api.getProjectWorker).not.toHaveBeenCalled();
  });

  it('worker project = worker PC ini dan tersambung ke hub: "Worker project tersambung" tanpa tombol', async () => {
    useUiStore.setState({ activeProjectId: PROJECT });
    api.getProjectWorker.mockResolvedValue(status());
    await renderScreen(<SidebarStatus />);

    expect(await screen.findByText(copy.projectWorker.connected)).toBeInTheDocument();
    expect(api.getProjectWorker).toHaveBeenCalledWith(PROJECT);
    expect(screen.queryByRole('button', { name: copy.projectWorker.useThisPc })).toBeNull();
  });

  it('worker lokal tersambung tetapi hub gateway tidak melihatnya: "Worker project offline", bukan "tersambung"', async () => {
    useUiStore.setState({ activeProjectId: PROJECT });
    api.getProjectWorker.mockResolvedValue(status({ online: false }));
    await renderScreen(<SidebarStatus />);

    expect(await screen.findByText(copy.projectWorker.offline)).toBeInTheDocument();
    expect(screen.queryByText(copy.workerStatus.connected)).toBeNull();
  });

  it('project terikat ke worker lama yang dicabut (login ulang): tombol memindahkan project ke worker PC ini', async () => {
    const user = userEvent.setup();
    useUiStore.setState({ activeProjectId: PROJECT });
    api.getProjectWorker
      .mockResolvedValueOnce(status({ workerDeviceId: OLD, online: false, revoked: true }))
      .mockResolvedValue(status());
    api.rebindProjectWorker.mockResolvedValue(project);
    await renderScreen(<SidebarStatus />);

    expect(await screen.findByText(copy.projectWorker.revoked)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: copy.projectWorker.useThisPc }));

    expect(api.rebindProjectWorker).toHaveBeenCalledWith(PROJECT, OWN);
    expect((await screen.findAllByText(copy.projectWorker.rebound)).length).toBeGreaterThan(0);
    // Status dimuat ulang dari gateway setelah pindah.
    expect(await screen.findByText(copy.projectWorker.connected)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: copy.projectWorker.useThisPc })).toBeNull();
  });

  it('ikat ulang ditolak gateway (run masih berjalan): pesan galat tampil, tombol tetap ada', async () => {
    const user = userEvent.setup();
    useUiStore.setState({ activeProjectId: PROJECT });
    api.getProjectWorker.mockResolvedValue(
      status({ workerDeviceId: OLD, revoked: true, online: false }),
    );
    api.rebindProjectWorker.mockRejectedValue(new Error('Masih ada tugas yang berjalan.'));
    await renderScreen(<SidebarStatus />);

    await user.click(await screen.findByRole('button', { name: copy.projectWorker.useThisPc }));
    await waitFor(() => expect(api.rebindProjectWorker).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: copy.projectWorker.useThisPc })).toBeEnabled();
  });

  it('worker lain tersambung (project milik PC lain): label nama worker, tanpa tombol pindah', async () => {
    useUiStore.setState({ activeProjectId: PROJECT });
    api.getProjectWorker.mockResolvedValue(status({ workerDeviceId: OLD, name: 'LAPTOP' }));
    await renderScreen(<SidebarStatus />);

    expect(await screen.findByText(copy.projectWorker.other('LAPTOP', true))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: copy.projectWorker.useThisPc })).toBeNull();
  });

  it('worker lain offline (worker lama belum dicabut): tombol pindah tersedia', async () => {
    useUiStore.setState({ activeProjectId: PROJECT });
    api.getProjectWorker.mockResolvedValue(
      status({ workerDeviceId: OLD, name: 'PC-LAMA', online: false }),
    );
    await renderScreen(<SidebarStatus />);

    expect(await screen.findByText(copy.projectWorker.other('PC-LAMA', false))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: copy.projectWorker.useThisPc })).toBeInTheDocument();
  });
});
