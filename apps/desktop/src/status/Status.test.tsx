import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SystemStatus } from '../api/gateway';
import { ApiProblem } from '../auth/authSession';
import { copy } from '../copy';
import { api, resetApi, setWorker } from '../test/fakeServices';
import { renderScreen } from '../test/render';

vi.mock('../app/services', async () => (await import('../test/fakeServices')).fakeServices);

const { StatusScreen } = await import('./StatusScreen');

const ok = { ok: true, latencyMs: 4 };
const status: SystemStatus = {
  gateway: { version: '0.1.0', adaptersVersion: '0.1.0', node: 'v22.12.0', uptimeSec: 90_000 },
  readiness: {
    status: 'degraded',
    checks: {
      postgres: ok,
      hermes: { ok: false, latencyMs: 2000, error: 'timeout' },
      ninerouter: ok,
      searxng: ok,
    },
  },
  workers: [
    {
      deviceId: '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f',
      name: 'PC kerja',
      online: true,
      lastSeenAt: '2026-10-22T06:38:00Z',
    },
    {
      deviceId: '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e90',
      name: 'Laptop',
      online: false,
      lastSeenAt: null,
    },
  ],
  jobs: [
    { queue: 'research', queued: 2, active: 1, failed: 3 },
    { queue: 'schedule', queued: 0, active: 0, failed: 0 },
  ],
  activeRuns: 2,
};

beforeEach(() => {
  resetApi();
  setWorker({
    local: 'connected',
    status: {
      gateway: 'connected',
      deviceId: 'd',
      activeRuns: 0,
      version: '0.1.0',
      ompVersion: '18.12.6',
      browserAvailable: true,
    },
  });
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

describe('StatusScreen', () => {
  it('versi, dependensi dengan alasan gagal, worker, dan antrean job', async () => {
    api.getStatus.mockResolvedValue(status);
    await renderScreen(<StatusScreen />, '/status');

    expect(await screen.findByText(copy.status.page.overall.degraded)).toBeInTheDocument();
    expect(screen.getByText('v22.12.0')).toBeInTheDocument();
    expect(screen.getByText('1 hari 1 jam')).toBeInTheDocument();

    const hermes = screen.getByRole('row', { name: new RegExp(copy.status.page.deps.hermes) });
    expect(within(hermes).getByText(/Tidak terjangkau \(timeout\)/)).toBeInTheDocument();
    const postgres = screen.getByRole('row', { name: new RegExp(copy.status.page.deps.postgres) });
    expect(within(postgres).getByText(copy.status.page.ok)).toBeInTheDocument();
    expect(within(postgres).getByText('4 ms')).toBeInTheDocument();

    expect(screen.getByText('18.12.6')).toBeInTheDocument();
    expect(screen.getByText(copy.status.page.browserYes)).toBeInTheDocument();
    expect(screen.getByText('PC kerja')).toBeInTheDocument();
    expect(screen.getByText(copy.status.page.offline)).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(`${copy.status.page.lastSeen}: ${copy.status.page.never}`)),
    ).toBeInTheDocument();

    const research = screen.getByRole('row', { name: /research/ });
    expect(within(research).getByText('3')).toHaveClass('text-danger');
  });

  it('omp tidak terpasang dan worker lokal belum tersambung ditampilkan apa adanya', async () => {
    setWorker({ local: 'off', status: null });
    api.getStatus.mockResolvedValue({
      ...status,
      workers: [],
      jobs: [],
      readiness: { ...status.readiness, status: 'ok' },
    });
    await renderScreen(<StatusScreen />, '/status');

    expect(await screen.findByText(copy.status.page.localOff)).toBeInTheDocument();
    expect(screen.getByText(copy.status.page.notInstalled)).toBeInTheDocument();
    expect(screen.getByText(copy.status.page.noWorkers)).toBeInTheDocument();
    expect(screen.getByText(copy.status.page.noJobs)).toBeInTheDocument();
  });

  it('memuat, error dengan coba lagi, dan offline', async () => {
    api.getStatus.mockReturnValue(new Promise(() => undefined));
    const loading = await renderScreen(<StatusScreen />, '/status');
    expect(
      await screen.findByRole('status', { name: copy.status.page.loading }),
    ).toBeInTheDocument();
    loading.unmount();

    api.getStatus.mockReset();
    api.getStatus.mockRejectedValueOnce(new ApiProblem(500, 'internal_error', 'x'));
    api.getStatus.mockResolvedValue(status);
    const user = userEvent.setup();
    const error = await renderScreen(<StatusScreen />, '/status');
    await user.click(await screen.findByRole('button', { name: copy.states.retry }));
    expect(await screen.findByText(copy.status.page.overall.degraded)).toBeInTheDocument();
    error.unmount();

    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    api.getStatus.mockReset();
    api.getStatus.mockRejectedValue(new Error('jaringan'));
    await renderScreen(<StatusScreen />, '/status');
    expect(await screen.findByText(copy.states.offline)).toBeInTheDocument();
  });
});
