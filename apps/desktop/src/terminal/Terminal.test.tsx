import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../copy';
import { useUiStore } from '../state/uiStore';
import { emitPush, resetApi, setWorker, workerApi } from '../test/fakeServices';
import { renderScreen } from '../test/render';
import { WorkerCallError } from '../worker/localClient';

// xterm.js butuh canvas dan pengukuran font yang tidak ada di jsdom: diganti tiruan yang mencatat pemakaiannya.
const xterm = vi.hoisted(() => ({
  instances: [] as {
    written: string[];
    disposed: boolean;
    emit: (data: string) => void;
    cols: number;
    rows: number;
  }[],
}));
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    written: string[] = [];
    disposed = false;
    cols = 100;
    rows = 30;
    private listener: ((data: string) => void) | undefined;
    constructor() {
      xterm.instances.push(this);
    }
    loadAddon = vi.fn();
    open = vi.fn();
    focus = vi.fn();
    write(data: string) {
      this.written.push(data);
    }
    onData(listener: (data: string) => void) {
      this.listener = listener;
      return { dispose: () => (this.listener = undefined) };
    }
    emit(data: string) {
      this.listener?.(data);
    }
    dispose() {
      this.disposed = true;
    }
  },
}));
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = vi.fn();
  },
}));
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));
vi.mock('../app/services', async () => (await import('../test/fakeServices')).fakeServices);

const { TerminalPanel } = await import('./TerminalPanel');

const PROJECT = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';
const RUN = '0192f0c4-7a1b-7c2d-9e3f-4a5b6c7d8e90';
const info = {
  id: 'term-1',
  cwd: 'C:\\proyek',
  shell: 'powershell.exe',
  replay: '',
  exitCode: null,
};

beforeEach(() => {
  resetApi();
  xterm.instances.length = 0;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      disconnect = vi.fn();
    },
  );
  setWorker({ local: 'connected', status: null });
  workerApi.terminalOpen.mockResolvedValue(info);
  workerApi.terminalWrite.mockResolvedValue(undefined);
  workerApi.terminalResize.mockResolvedValue(undefined);
  workerApi.terminalClose.mockResolvedValue(undefined);
  useUiStore.setState({ activeProjectId: PROJECT, reviewRunId: null });
});

describe('TerminalPanel', () => {
  it('tanpa project aktif atau worker offline: pesan, tanpa membuka terminal', async () => {
    useUiStore.setState({ activeProjectId: null });
    const first = await renderScreen(<TerminalPanel />);
    expect(await screen.findByText(copy.terminal.noProject)).toBeInTheDocument();
    first.unmount();

    useUiStore.setState({ activeProjectId: PROJECT });
    setWorker({ local: 'off', status: null });
    await renderScreen(<TerminalPanel />);
    expect(await screen.findByText(copy.terminal.workerOffline)).toBeInTheDocument();
    expect(workerApi.terminalOpen).not.toHaveBeenCalled();
  });

  it('membuka terminal project dengan ukuran xterm; riwayat ditulis; keluaran worker tampil; ketikan dikirim', async () => {
    workerApi.terminalOpen.mockResolvedValue({ ...info, replay: 'PS C:\\proyek> ' });
    await renderScreen(<TerminalPanel />);

    await waitFor(() => expect(xterm.instances[0]?.written).toEqual(['PS C:\\proyek> ']));
    expect(workerApi.terminalOpen).toHaveBeenCalledWith({
      projectId: PROJECT,
      cols: 100,
      rows: 30,
    });
    expect(screen.getByText(copy.terminal.scope.project)).toBeInTheDocument();

    act(() => emitPush({ push: 'terminal.data', terminalId: 'term-1', data: 'halo\r\n' }));
    // Keluaran terminal lain diabaikan.
    act(() => emitPush({ push: 'terminal.data', terminalId: 'term-lain', data: 'bukan-aku' }));
    expect(xterm.instances[0]?.written).toEqual(['PS C:\\proyek> ', 'halo\r\n']);

    xterm.instances[0]?.emit('dir\r');
    expect(workerApi.terminalWrite).toHaveBeenCalledWith('term-1', 'dir\r');
  });

  it('hasil run yang ditinjau: terminal worktree run itu', async () => {
    useUiStore.setState({ reviewRunId: RUN });
    await renderScreen(<TerminalPanel />);

    await waitFor(() =>
      expect(workerApi.terminalOpen).toHaveBeenCalledWith({
        projectId: PROJECT,
        runId: RUN,
        cols: 100,
        rows: 30,
      }),
    );
    expect(await screen.findByText(copy.terminal.scope.run)).toBeInTheDocument();
  });

  it('shell berhenti: kode keluar dan tombol buka lagi yang membuat shell baru', async () => {
    const user = userEvent.setup();
    await renderScreen(<TerminalPanel />);
    await waitFor(() => expect(workerApi.terminalOpen).toHaveBeenCalledTimes(1));
    await screen.findByText(copy.terminal.scope.project);

    act(() => emitPush({ push: 'terminal.exit', terminalId: 'term-1', exitCode: 0 }));
    expect(await screen.findByRole('status')).toHaveTextContent(copy.terminal.exited(0));
    await user.click(screen.getByRole('button', { name: copy.terminal.restart }));

    await waitFor(() => expect(workerApi.terminalOpen).toHaveBeenCalledTimes(2));
    expect(xterm.instances[0]?.disposed).toBe(true);
  });

  it('tutup terminal mematikan shell lalu membuka yang baru', async () => {
    const user = userEvent.setup();
    await renderScreen(<TerminalPanel />);

    await user.click(await screen.findByRole('button', { name: copy.terminal.close }));

    expect(workerApi.terminalClose).toHaveBeenCalledWith('term-1');
    await waitFor(() => expect(workerApi.terminalOpen).toHaveBeenCalledTimes(2));
  });

  it('gagal membuka: pesan dari worker dan coba lagi', async () => {
    workerApi.terminalOpen.mockRejectedValueOnce(
      new WorkerCallError('terminal_unavailable', 'Project ini belum terikat ke folder.'),
    );
    const user = userEvent.setup();
    await renderScreen(<TerminalPanel />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      copy.workerErrors.terminal_unavailable,
    );
    await user.click(screen.getByRole('button', { name: copy.terminal.retry }));

    await waitFor(() => expect(workerApi.terminalOpen).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(copy.terminal.scope.project)).toBeInTheDocument();
  });

  it('meninggalkan tab hanya melepas tampilan; shell tidak ditutup', async () => {
    const view = await renderScreen(<TerminalPanel />);
    await waitFor(() => expect(workerApi.terminalOpen).toHaveBeenCalled());

    view.unmount();

    expect(xterm.instances[0]?.disposed).toBe(true);
    expect(workerApi.terminalClose).not.toHaveBeenCalled();
  });
});

describe('TerminalPanel: aksi keadaan kosong', () => {
  it.each([
    ['tanpa project', null, 'connected', copy.states.pickProject, '/workspace'],
    ['worker offline', PROJECT, 'off', copy.states.viewStatus, '/status'],
  ] as const)(
    '%s: tombol menuju layar yang memperbaikinya',
    async (_n, project, local, label, path) => {
      useUiStore.setState({ activeProjectId: project });
      setWorker({ local, status: null });
      const user = userEvent.setup();
      const { router } = await renderScreen(<TerminalPanel />);
      await user.click(await screen.findByRole('button', { name: label }));
      await waitFor(() => expect(router.state.location.pathname).toBe(path));
    },
  );
});
