import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../copy';
import { localWorker, resetApi, setWorker, workerService } from '../test/fakeServices';
import { renderScreen } from '../test/render';

vi.mock('../app/services', async () => (await import('../test/fakeServices')).fakeServices);

const { WorkerLifecycle } = await import('./WorkerLifecycle');
const { StatusBar } = await import('../shell/StatusBar');

beforeEach(() => {
  resetApi();
  localWorker.start.mockClear();
  localWorker.stop.mockClear();
  workerService.start.mockClear();
  workerService.stop.mockClear();
});

describe('WorkerLifecycle', () => {
  it('memulai worker lokal dan layanan sesi saat sudah login; menghentikannya saat dilepas', () => {
    const view = render(<WorkerLifecycle />);

    expect(localWorker.start).toHaveBeenCalledTimes(1);
    expect(workerService.start).toHaveBeenCalledTimes(1);

    view.unmount();

    expect(workerService.stop).toHaveBeenCalledTimes(1);
    expect(localWorker.stop).toHaveBeenCalledTimes(1);
  });
});

describe('StatusBar: status worker', () => {
  it('tersambung, menyambung ulang, dan mati mengikuti keadaan worker', async () => {
    setWorker({
      local: 'connected',
      status: {
        gateway: 'connected',
        deviceId: 'd',
        activeRuns: 0,
        version: '0.1.0',
        ompVersion: null,
        browserAvailable: false,
      },
    });
    await renderScreen(<StatusBar />);
    expect(screen.getByRole('status', { name: copy.workerStatus.connected })).toBeInTheDocument();

    act(() => setWorker({ local: 'reconnecting', status: null }));
    expect(
      screen.getByRole('status', { name: copy.workerStatus.reconnecting }),
    ).toBeInTheDocument();

    act(() => setWorker({ local: 'off', status: null }));
    expect(screen.getByRole('status', { name: copy.workerStatus.off })).toBeInTheDocument();
  });
});
