import type { Conversation, Project } from '@aios/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../copy';
import { useUiStore } from '../state/uiStore';
import { TS, uid } from '../test/fixtures';
import { api, resetApi } from '../test/fakeServices';
import { renderScreen } from '../test/render';

vi.mock('../app/services', async () => (await import('../test/fakeServices')).fakeServices);

const { ProjectSwitcher } = await import('./ProjectSwitcher');
const { ConversationList } = await import('./ConversationList');

const WORKER = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';
const project = (name: string): Project => ({
  id: uid(),
  name,
  workerDeviceId: WORKER,
  stack: { languages: [], frameworks: [] },
  defaultBranch: 'main',
  createdAt: TS,
  updatedAt: TS,
});
const conversation = (title: string, projectId: string | null): Conversation => ({
  id: uid(),
  title,
  surface: 'windows',
  projectId,
  pinned: false,
  archivedAt: null,
  createdAt: TS,
  updatedAt: TS,
});

beforeEach(() => {
  resetApi();
  useUiStore.setState(useUiStore.getInitialState(), true);
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

describe('ProjectSwitcher', () => {
  it('menampilkan Chat umum secara bawaan; memilih project menyimpannya dan membuka chat baru', async () => {
    const toko = project('Toko Online');
    api.listProjects.mockResolvedValue([toko, project('Blog')]);
    const user = userEvent.setup();
    const { router } = await renderScreen(<ProjectSwitcher />, '/chat/abc');
    expect(
      await screen.findByRole('button', {
        name: `${copy.projectSwitcher.label}: ${copy.projectSwitcher.general}`,
      }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: new RegExp(`${copy.projectSwitcher.label}:`) }),
    );
    await user.click(await screen.findByRole('menuitemradio', { name: 'Toko Online' }));

    expect(useUiStore.getState().activeProjectId).toBe(toko.id);
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(
      screen.getByRole('button', { name: `${copy.projectSwitcher.label}: Toko Online` }),
    ).toBeInTheDocument();
  });

  it('kembali ke Chat umum membersihkan project aktif dan branch run', async () => {
    const toko = project('Toko Online');
    api.listProjects.mockResolvedValue([toko]);
    useUiStore.getState().setActiveProject(toko.id);
    useUiStore.getState().setActiveRunBranch('aios/abcd1234');
    const user = userEvent.setup();
    await renderScreen(<ProjectSwitcher />);

    await user.click(
      await screen.findByRole('button', { name: `${copy.projectSwitcher.label}: Toko Online` }),
    );
    await user.click(
      await screen.findByRole('menuitemradio', { name: copy.projectSwitcher.general }),
    );

    expect(useUiStore.getState().activeProjectId).toBeNull();
    expect(useUiStore.getState().activeRunBranch).toBeNull();
  });

  it('belum ada project: petunjuk menambahkannya; project aktif yang sudah tidak ada jatuh ke Chat umum', async () => {
    useUiStore.getState().setActiveProject(uid());
    await renderScreen(<ProjectSwitcher />);

    expect(await screen.findByText(copy.projectSwitcher.none)).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: `${copy.projectSwitcher.label}: ${copy.projectSwitcher.general}`,
      }),
    ).toBeInTheDocument();
  });
});

describe('ConversationList per project', () => {
  it('di dalam project hanya percakapan project itu; chat umum menyembunyikan percakapan project', async () => {
    const toko = project('Toko Online');
    api.listConversations.mockResolvedValue({
      items: [
        conversation('Umum A', null),
        conversation('Toko 1', toko.id),
        conversation('Lain', uid()),
      ],
      nextBefore: null,
    });

    const general = await renderScreen(<ConversationList />);
    expect(await screen.findByRole('link', { name: 'Umum A' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Toko 1' })).not.toBeInTheDocument();
    expect(api.listConversations).toHaveBeenLastCalledWith(undefined, undefined);
    general.unmount();

    useUiStore.getState().setActiveProject(toko.id);
    await renderScreen(<ConversationList />);
    expect(await screen.findByRole('link', { name: 'Toko 1' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Umum A' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Lain' })).not.toBeInTheDocument();
    expect(api.listConversations).toHaveBeenLastCalledWith(undefined, toko.id);
  });
});

describe('uiStore: project aktif', () => {
  it('project aktif disimpan antar sesi; branch run tidak; berganti project membersihkan branch', () => {
    useUiStore.getState().setActiveProject('p1');
    useUiStore.getState().setActiveRunBranch('aios/abcd1234');
    const saved = JSON.parse(localStorage.getItem('aios.ui') ?? '{}') as {
      state: Record<string, unknown>;
    };

    expect(saved.state.activeProjectId).toBe('p1');
    expect(saved.state).not.toHaveProperty('activeRunBranch');

    useUiStore.getState().setActiveProject('p2');
    expect(useUiStore.getState().activeRunBranch).toBeNull();
  });
});
