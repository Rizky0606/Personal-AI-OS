import type { Space, SpaceDocument } from '@aios/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../copy';
import { TS } from '../test/fixtures';
import { api, resetApi } from '../test/fakeServices';
import { renderScreen } from '../test/render';

vi.mock('../app/services', async () => (await import('../test/fakeServices')).fakeServices);

const { SpacesScreen } = await import('./SpacesScreen');
const { SpaceDetailScreen } = await import('./SpaceDetailScreen');
const { SpaceList } = await import('./SpaceList');

const s = copy.spaces;
const SPACE = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';
const CONV = '0192f0c4-7a1b-7c2d-9e3f-4a5b6c7d8e90';
const FILE = '0192f0c4-7a1b-7c2d-a001-4a5b6c7d8e91';

const space = (over: Partial<Space> = {}): Space => ({
  id: SPACE,
  name: 'Kontrak kerja',
  description: 'Semua kontrak 2026',
  documentCount: 1,
  createdAt: TS,
  updatedAt: TS,
  ...over,
});
const doc = (over: Partial<SpaceDocument> = {}): SpaceDocument => ({
  id: '0192f0c4-7a1b-7c2d-a002-4a5b6c7d8e92',
  spaceId: SPACE,
  fileId: FILE,
  name: 'kontrak.pdf',
  chars: 12345,
  chunks: 11,
  createdAt: TS,
  ...over,
});
const conversation = {
  id: CONV,
  title: 'Denda keterlambatan',
  surface: 'windows' as const,
  projectId: null,
  spaceId: SPACE,
  pinned: false,
  archivedAt: null,
  createdAt: TS,
  updatedAt: TS,
};

beforeEach(() => {
  resetApi();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

describe('SpacesScreen dan SpaceList', () => {
  it('membuat ruang lalu membuka detailnya; sidebar menampilkan jumlah dokumen', async () => {
    const user = userEvent.setup();
    api.createSpace.mockResolvedValue(space({ documentCount: 0 }));
    api.listSpaces.mockResolvedValue([space()]);
    const { router } = await renderScreen(
      <>
        <SpaceList />
        <SpacesScreen />
      </>,
      '/spaces',
    );
    const list = await screen.findByRole('navigation', { name: s.listLabel });
    expect(within(list).getByText(s.documentCount(1))).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: s.name }), '  Kontrak kerja ');
    await user.click(screen.getByRole('button', { name: s.create }));
    expect(api.createSpace).toHaveBeenCalledWith('Kontrak kerja', '');
    await waitFor(() => expect(router.state.location.pathname).toBe(`/spaces/${SPACE}`));
  });
});

describe('SpaceList kosong', () => {
  it('Buat ruang baru membawa ke formulir ruang', async () => {
    const user = userEvent.setup();
    api.listSpaces.mockResolvedValue([]);
    const { router } = await renderScreen(<SpaceList />, '/');
    await user.click(await screen.findByRole('button', { name: s.createNew }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/spaces'));
  });
});

describe('SpaceDetailScreen', () => {
  it('dokumen dan percakapan ruang tampil; unggah berkas mengindeksnya; chat baru terikat ruang', async () => {
    const user = userEvent.setup();
    api.listSpaces.mockResolvedValue([space()]);
    api.listSpaceDocuments.mockResolvedValue([doc()]);
    api.listSpaceConversations.mockResolvedValue({ items: [conversation], nextBefore: null });
    api.uploadFile.mockResolvedValue({
      id: FILE,
      name: 'catatan.txt',
      mime: 'text/plain',
      size: 5,
      sha256: 'x',
      createdAt: TS,
    });
    api.addSpaceDocument.mockResolvedValue(doc({ name: 'catatan.txt' }));
    api.createConversation.mockResolvedValue(conversation);
    const { router } = await renderScreen(
      <SpaceDetailScreen spaceId={SPACE} />,
      `/spaces/${SPACE}`,
    );

    const docs = await screen.findByRole('list', { name: s.documents });
    expect(within(docs).getByText('kontrak.pdf')).toBeInTheDocument();
    expect(within(docs).getByText(s.docMeta(12345, 11))).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Denda keterlambatan' })).toBeInTheDocument();

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    await user.upload(input, new File(['halo'], 'catatan.txt', { type: 'text/plain' }));
    await waitFor(() => expect(api.addSpaceDocument).toHaveBeenCalledWith(SPACE, FILE));
    expect(await screen.findByText(s.added('catatan.txt'))).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: s.newChat }));
    expect(api.createConversation).toHaveBeenCalledWith('windows', undefined, SPACE);
    await waitFor(() => expect(router.state.location.pathname).toBe(`/chat/${CONV}`));
  });

  it('keluarkan dokumen dan hapus ruang dengan konfirmasi', async () => {
    const user = userEvent.setup();
    api.listSpaces.mockResolvedValue([space()]);
    api.listSpaceDocuments.mockResolvedValue([doc()]);
    api.deleteSpaceDocument.mockResolvedValue(undefined);
    api.deleteSpace.mockResolvedValue(undefined);
    const { router } = await renderScreen(
      <SpaceDetailScreen spaceId={SPACE} />,
      `/spaces/${SPACE}`,
    );

    const docs = await screen.findByRole('list', { name: s.documents });
    await user.click(within(docs).getByRole('button', { name: s.removeDocument }));
    expect(api.deleteSpaceDocument).toHaveBeenCalledWith(SPACE, doc().id);

    await user.click(screen.getByRole('button', { name: s.delete }));
    const dialog = await screen.findByRole('dialog', { name: s.deleteTitle });
    await user.click(within(dialog).getByRole('button', { name: s.delete }));
    await waitFor(() => expect(api.deleteSpace).toHaveBeenCalledWith(SPACE));
    await waitFor(() => expect(router.state.location.pathname).toBe('/spaces'));
  });

  it('ruang kosong: ajakan menambah dokumen dan belum ada percakapan', async () => {
    api.listSpaces.mockResolvedValue([space({ documentCount: 0 })]);
    await renderScreen(<SpaceDetailScreen spaceId={SPACE} />, `/spaces/${SPACE}`);
    expect(await screen.findByText(s.documentsEmpty)).toBeInTheDocument();
    expect(screen.getByText(s.conversationsEmpty)).toBeInTheDocument();
  });

  it('ruang kosong: Pilih dokumen membuka pemilih berkas, Mulai percakapan membuat chat ruang', async () => {
    const user = userEvent.setup();
    api.listSpaces.mockResolvedValue([space({ documentCount: 0 })]);
    api.createConversation.mockResolvedValue(conversation);
    const { router } = await renderScreen(
      <SpaceDetailScreen spaceId={SPACE} />,
      `/spaces/${SPACE}`,
    );
    const input = await waitFor(() => {
      const el = document.querySelector<HTMLInputElement>('input[type="file"]');
      expect(el).not.toBeNull();
      return el!;
    });
    const clicked = vi.fn();
    input.addEventListener('click', clicked);
    await user.click(await screen.findByRole('button', { name: s.pickDocument }));
    expect(clicked).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: s.startChat }));
    expect(api.createConversation).toHaveBeenCalledWith('windows', undefined, SPACE);
    await waitFor(() => expect(router.state.location.pathname).toBe(`/chat/${CONV}`));
  });

  it('ruang tidak ada: Lihat ruang membuka daftar ruang', async () => {
    const user = userEvent.setup();
    api.listSpaces.mockResolvedValue([]);
    const { router } = await renderScreen(
      <SpaceDetailScreen spaceId={SPACE} />,
      `/spaces/${SPACE}`,
    );
    await user.click(await screen.findByRole('button', { name: s.viewAll }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/spaces'));
  });
});
