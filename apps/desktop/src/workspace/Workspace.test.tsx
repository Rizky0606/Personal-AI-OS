import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProblem } from '../auth/authSession';
import { copy } from '../copy';
import { CONV, RUN_1, RUN_2, run } from '../test/fixtures';
import { api, resetApi } from '../test/fakeServices';
import { renderScreen } from '../test/render';
import type { WorkspaceRun } from './runs';

vi.mock('../app/services', async () => (await import('../test/fakeServices')).fakeServices);

const { WorkspaceScreen } = await import('./WorkspaceScreen');

const entry = (over: Partial<WorkspaceRun['run']>, title: string): WorkspaceRun => ({
  run: run({ kind: 'coding', engine: 'omp', branch: 'aios/run-1', ...over }),
  title,
  projectId: null,
  projectName: 'Aplikasi Todo',
});

beforeEach(() => {
  resetApi();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

describe('WorkspaceScreen', () => {
  it('daftar run dengan status, project, dan branch; filter menyaring', async () => {
    api.listRuns.mockResolvedValue([
      entry({ id: RUN_1, status: 'running' }, 'Tambah dark mode'),
      entry({ id: RUN_2, status: 'needs_review', conversationId: null }, 'Perbaiki login'),
    ]);
    const user = userEvent.setup();
    await renderScreen(<WorkspaceScreen />, '/workspace');

    const list = await screen.findByRole('list', { name: copy.workspace.title });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).getAllByText(/Aplikasi Todo/)).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: /Perlu ditinjau/ }));
    expect(
      within(screen.getByRole('list', { name: copy.workspace.title })).getAllByRole('listitem'),
    ).toHaveLength(1);
    expect(screen.getByText('Perbaiki login')).toBeInTheDocument();
    expect(screen.queryByText('Tambah dark mode')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Selesai/ }));
    expect(await screen.findByText(copy.workspace.emptyFilter)).toBeInTheDocument();
  });

  it('membuka run dari percakapan ke chat, dan run dari kartu ke kanban', async () => {
    api.listRuns.mockResolvedValue([
      entry({ id: RUN_1, status: 'running' }, 'Dari chat'),
      entry({ id: RUN_2, status: 'running', conversationId: null }, 'Dari kartu'),
    ]);
    const user = userEvent.setup();
    const { router } = await renderScreen(<WorkspaceScreen />, '/workspace');

    await user.click(
      await screen.findByRole('button', { name: `${copy.workspace.open}: Dari kartu` }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe('/kanban'));
    await router.navigate({ to: '/workspace' });
    await user.click(screen.getByRole('button', { name: `${copy.workspace.open}: Dari chat` }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/chat/${CONV}`));
  });

  it('Hentikan hanya untuk run yang masih berjalan dan memanggil server', async () => {
    api.listRuns.mockResolvedValue([
      entry({ id: RUN_1, status: 'running' }, 'Berjalan'),
      entry({ id: RUN_2, status: 'needs_review' }, 'Menunggu tinjauan'),
    ]);
    api.cancelRun.mockResolvedValue(run({ id: RUN_1, status: 'cancelled' }));
    const user = userEvent.setup();
    await renderScreen(<WorkspaceScreen />, '/workspace');

    expect(
      await screen.findAllByRole('button', { name: new RegExp(copy.workspace.stop) }),
    ).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: `${copy.workspace.stop}: Berjalan` }));
    expect(api.cancelRun).toHaveBeenCalledWith(RUN_1);
  });

  it('kosong, error dengan Coba lagi, dan offline', async () => {
    api.listRuns.mockResolvedValueOnce([]);
    const view = await renderScreen(<WorkspaceScreen />, '/workspace');
    expect(await screen.findByText(copy.workspace.empty)).toBeInTheDocument();
    view.unmount();

    api.listRuns.mockRejectedValueOnce(new ApiProblem(500, 'x', 'x'));
    const user = userEvent.setup();
    const again = await renderScreen(<WorkspaceScreen />, '/workspace');
    expect(await screen.findByRole('alert')).toHaveTextContent(copy.errors.server);
    api.listRuns.mockResolvedValue([entry({ id: RUN_1, status: 'running' }, 'Pulih')]);
    await user.click(screen.getByRole('button', { name: copy.states.retry }));
    expect(await screen.findByText('Pulih')).toBeInTheDocument();
    again.unmount();

    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    api.listRuns.mockRejectedValue(new ApiProblem(0, 'network', 'x'));
    await renderScreen(<WorkspaceScreen />, '/workspace');
    expect(await screen.findByText(copy.states.offline)).toBeInTheDocument();
  });
});
