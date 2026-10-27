import type { Conversation, Project } from '@aios/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../copy';
import { useUiStore } from '../state/uiStore';
import { CONV, TS, models, roles } from '../test/fixtures';
import { api, resetApi } from '../test/fakeServices';
import { renderScreen } from '../test/render';

vi.mock('../app/services', async () => (await import('../test/fakeServices')).fakeServices);

const { GeneralChatRoute, ProjectChatRoute } = await import('./ProjectRoutes');
const { WorkspaceSidebar } = await import('./WorkspaceSidebar');

const PROJECT = '0192f0c4-7a1b-7c2d-a001-4a5b6c7d8e91';
const OTHER = '0192f0c4-7a1b-7c2d-a002-4a5b6c7d8e92';
const WORKER = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';

const project = (id: string, name: string): Project => ({
  id,
  name,
  workerDeviceId: WORKER,
  stack: { languages: ['typescript'], frameworks: [] },
  defaultBranch: 'main',
  instructions: '',
  createdAt: TS,
  updatedAt: TS,
});

const conversation = (projectId: string | null, title = 'Ide fitur'): Conversation => ({
  id: CONV,
  title,
  surface: 'windows',
  projectId,
  spaceId: null,
  pinned: false,
  archivedAt: null,
  createdAt: TS,
  updatedAt: TS,
});

beforeEach(() => {
  resetApi();
  useUiStore.setState(useUiStore.getInitialState(), true);
  api.listRoles.mockResolvedValue(roles);
  api.listModels.mockResolvedValue(models);
  api.listProjects.mockResolvedValue([project(PROJECT, 'Toko Online'), project(OTHER, 'Blog')]);
  api.listMessages.mockResolvedValue({ items: [], nextBefore: null });
  api.listConversations.mockResolvedValue({ items: [], nextBefore: null });
  api.listRuns.mockResolvedValue([]);
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

describe('rute chat umum dan chat project', () => {
  it('tab Chat selalu chat umum: konteks project dilepas', async () => {
    useUiStore.getState().setActiveProject(PROJECT);
    await renderScreen(<GeneralChatRoute conversationId={undefined} />);

    await waitFor(() => expect(useUiStore.getState().activeProjectId).toBeNull());
  });

  it('percakapan project yang dibuka lewat tab Chat dialihkan ke tab Project', async () => {
    api.getConversation.mockResolvedValue(conversation(PROJECT));
    const { router } = await renderScreen(
      <GeneralChatRoute conversationId={CONV} />,
      `/chat/${CONV}`,
    );

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/workspace/${PROJECT}/${CONV}`),
    );
  });

  it('tab Project menyetel konteks ke project yang dipilih', async () => {
    await renderScreen(
      <ProjectChatRoute projectId={PROJECT} conversationId={undefined} />,
      `/workspace/${PROJECT}`,
    );

    await waitFor(() => expect(useUiStore.getState().activeProjectId).toBe(PROJECT));
    expect(
      await screen.findByRole('heading', { name: copy.chat.welcome.project.title }),
    ).toBeInTheDocument();
  });

  it('percakapan umum di tab Project dialihkan ke tab Chat; milik project lain ke project itu', async () => {
    api.getConversation.mockResolvedValue(conversation(null));
    const first = await renderScreen(
      <ProjectChatRoute projectId={PROJECT} conversationId={CONV} />,
      `/workspace/${PROJECT}/${CONV}`,
    );
    await waitFor(() => expect(first.router.state.location.pathname).toBe(`/chat/${CONV}`));
    first.unmount();

    api.getConversation.mockResolvedValue(conversation(OTHER));
    const second = await renderScreen(
      <ProjectChatRoute projectId={PROJECT} conversationId={CONV} />,
      `/workspace/${PROJECT}/${CONV}`,
    );
    await waitFor(() =>
      expect(second.router.state.location.pathname).toBe(`/workspace/${OTHER}/${CONV}`),
    );
  });

  it('project yang sudah tidak ada: kembali ke ikhtisar Project', async () => {
    const { router } = await renderScreen(
      <ProjectChatRoute
        projectId="0192f0c4-7a1b-7c2d-a009-4a5b6c7d8e99"
        conversationId={undefined}
      />,
      '/workspace/0192f0c4-7a1b-7c2d-a009-4a5b6c7d8e99',
    );

    await waitFor(() => expect(router.state.location.pathname).toBe('/workspace'));
  });
});

describe('WorkspaceSidebar', () => {
  it('menampilkan semua project; membuka satu menampilkan percakapannya dengan tautan ke tab Project', async () => {
    api.listConversations.mockResolvedValue({
      items: [conversation(PROJECT, 'Ide Fitur Tambahan')],
      nextBefore: null,
    });
    const user = userEvent.setup();
    await renderScreen(<WorkspaceSidebar />, '/workspace');

    const list = await screen.findByRole('list', { name: copy.projects.listLabel });
    expect(within(list).getByText('Toko Online')).toBeInTheDocument();
    expect(within(list).getByText('Blog')).toBeInTheDocument();
    expect(screen.queryByText('Ide Fitur Tambahan')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: `${copy.workspace.expand}: Toko Online` }));
    const link = await screen.findByRole('link', { name: 'Ide Fitur Tambahan' });
    expect(link).toHaveAttribute('href', `/workspace/${PROJECT}/${CONV}`);
    expect(screen.getByRole('link', { name: copy.workspace.manage })).toHaveAttribute(
      'href',
      '/projects',
    );
  });

  it('project tanpa percakapan menampilkan keterangan kosong; tanpa project menampilkan keadaan kosong', async () => {
    const user = userEvent.setup();
    const first = await renderScreen(<WorkspaceSidebar />, '/workspace');
    await user.click(await screen.findByRole('button', { name: `${copy.workspace.expand}: Blog` }));
    expect(await screen.findByText(copy.workspace.noChats)).toBeInTheDocument();
    first.unmount();

    api.listProjects.mockResolvedValue([]);
    await renderScreen(<WorkspaceSidebar />, '/workspace');
    expect(await screen.findByText(copy.projects.empty)).toBeInTheDocument();
  });

  it('project yang sedang dikerjakan agent diberi penanda status', async () => {
    const { run } = await import('../test/fixtures');
    api.listRuns.mockResolvedValue([
      {
        run: run({ kind: 'coding', engine: 'omp', status: 'running' }),
        title: 'Tambah dark mode',
        projectId: PROJECT,
        projectName: 'Toko Online',
      },
    ]);
    await renderScreen(<WorkspaceSidebar />, '/workspace');

    expect(await screen.findByRole('img', { name: copy.runStatus.running })).toBeInTheDocument();
  });
});
