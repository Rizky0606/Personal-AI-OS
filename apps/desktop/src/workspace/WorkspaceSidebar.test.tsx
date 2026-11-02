import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../copy';
import { api, resetApi } from '../test/fakeServices';
import { renderScreen } from '../test/render';

vi.mock('../app/services', async () => (await import('../test/fakeServices')).fakeServices);

const { WorkspaceSidebar } = await import('./WorkspaceSidebar');

beforeEach(() => {
  resetApi();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

describe('WorkspaceSidebar: aksi di keadaan kosong', () => {
  it('di tab Project (bawaan): tombol Tambah project ada dan membuka dialog', async () => {
    const user = userEvent.setup();
    await renderScreen(<WorkspaceSidebar />, '/workspace');
    await user.click(await screen.findByRole('button', { name: copy.projects.add }));
    expect(
      await screen.findByRole('dialog', { name: copy.projects.dialog.title }),
    ).toBeInTheDocument();
  });

  it('di Kelola project (addInMain): tombol tambah hanya di area utama, sidebar menawarkan muat ulang', async () => {
    const user = userEvent.setup();
    await renderScreen(<WorkspaceSidebar addInMain />, '/projects');
    expect(await screen.findByText(copy.projects.empty)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: copy.projects.add })).not.toBeInTheDocument();

    api.listProjects.mockClear();
    await user.click(screen.getByRole('button', { name: copy.states.retry }));
    expect(api.listProjects).toHaveBeenCalled();
  });
});
