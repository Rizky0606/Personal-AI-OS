import type { Conversation } from '@aios/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProblem } from '../auth/authSession';
import { copy } from '../copy';
import { CONV, TS, uid } from '../test/fixtures';
import { api, resetApi } from '../test/fakeServices';
import { useUiStore } from '../state/uiStore';
import { renderScreen } from '../test/render';

vi.mock('../app/services', async () => (await import('../test/fakeServices')).fakeServices);

const { ConversationList } = await import('./ConversationList');

function conversation(over: Partial<Conversation> = {}): Conversation {
  return {
    id: uid(),
    title: 'Judul',
    surface: 'windows',
    projectId: null,
    spaceId: null,
    pinned: false,
    archivedAt: null,
    createdAt: TS,
    updatedAt: TS,
    ...over,
  };
}

beforeEach(() => {
  resetApi();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

describe('ConversationList', () => {
  it('yang disematkan tampil di atas; judul kosong memakai teks bawaan', async () => {
    api.listConversations.mockResolvedValue({
      items: [
        conversation({ title: 'Biasa' }),
        conversation({ title: 'Penting', pinned: true }),
        conversation({ title: '' }),
      ],
      nextBefore: null,
    });
    await renderScreen(<ConversationList />);

    const nav = await screen.findByRole('navigation', { name: copy.chat.listLabel });
    const links = within(nav).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['Penting', 'Biasa', copy.chat.untitled]);
  });

  it('kosong, error dengan Coba lagi, dan offline punya tampilan sendiri', async () => {
    const view = await renderScreen(<ConversationList />);
    expect(await screen.findByText(copy.chat.listEmpty)).toBeInTheDocument();
    view.unmount();

    api.listConversations.mockRejectedValue(new ApiProblem(500, 'x', 'x'));
    const failed = await renderScreen(<ConversationList />);
    expect(await screen.findByRole('alert')).toHaveTextContent(copy.errors.server);
    expect(screen.getByRole('button', { name: copy.states.retry })).toBeInTheDocument();
    failed.unmount();

    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    api.listConversations.mockRejectedValue(new ApiProblem(0, 'network', 'x'));
    await renderScreen(<ConversationList />);
    expect(await screen.findByText(copy.states.offline)).toBeInTheDocument();
  });

  it('kosong: Mulai percakapan meminta chat baru dan membuka layar chat', async () => {
    const user = userEvent.setup();
    const view = await renderScreen(<ConversationList />, '/status');
    const before = useUiStore.getState().newChatSignal;

    await user.click(await screen.findByRole('button', { name: copy.chat.startConversation }));

    expect(useUiStore.getState().newChatSignal).toBe(before + 1);
    await waitFor(() => expect(view.router.state.location.pathname).toBe('/'));
  });

  it('menu baris: sematkan, ubah judul, arsipkan', async () => {
    const item = conversation({ title: 'Lama' });
    api.listConversations.mockResolvedValue({ items: [item], nextBefore: null });
    api.updateConversation.mockResolvedValue(item);
    api.archiveConversation.mockResolvedValue(undefined);
    const user = userEvent.setup();
    await renderScreen(<ConversationList />);

    const open = async () =>
      user.click(await screen.findByRole('button', { name: `${copy.chat.menu}: Lama` }));

    await open();
    await user.click(await screen.findByRole('menuitem', { name: copy.chat.pin }));
    expect(api.updateConversation).toHaveBeenCalledWith(item.id, { pinned: true });

    await open();
    await user.click(await screen.findByRole('menuitem', { name: copy.chat.rename }));
    const input = await screen.findByRole('textbox', { name: copy.chat.renameLabel });
    await user.clear(input);
    await user.type(input, 'Baru{Enter}');
    expect(api.updateConversation).toHaveBeenCalledWith(item.id, { title: 'Baru' });

    await open();
    await user.click(await screen.findByRole('menuitem', { name: copy.chat.archive }));
    await waitFor(() => expect(api.archiveConversation).toHaveBeenCalledWith(item.id));
  });

  it('menu baris: Hapus meminta konfirmasi lalu menghapus permanen', async () => {
    const item = conversation({ title: 'Coba fitur' });
    api.listConversations.mockResolvedValue({ items: [item], nextBefore: null });
    api.deleteConversation.mockResolvedValue(undefined);
    const user = userEvent.setup();
    await renderScreen(<ConversationList />);

    await user.click(await screen.findByRole('button', { name: `${copy.chat.menu}: Coba fitur` }));
    await user.click(await screen.findByRole('menuitem', { name: copy.chat.deleteConversation }));
    const dialog = await screen.findByRole('dialog', { name: copy.chat.deleteConversationTitle });
    expect(api.deleteConversation).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: copy.chat.deleteConversation }));
    await waitFor(() => expect(api.deleteConversation).toHaveBeenCalledWith(item.id));
    expect(await screen.findByText(copy.chat.deleted)).toBeInTheDocument();
  });

  it('menu baris: Lanjut dengan ringkasan memanggil server dengan model pilihan dan membuka percakapan baru', async () => {
    const item = conversation({ title: 'Panjang' });
    const next = conversation({ title: 'Lanjutan: Panjang' });
    api.listConversations.mockResolvedValue({ items: [item], nextBefore: null });
    api.listModels.mockResolvedValue([
      { id: 'peringkas', label: 'Peringkas', kind: 'model', ownedBy: 'x' },
    ]);
    api.handoffConversation.mockResolvedValue(next);
    const user = userEvent.setup();
    const { router } = await renderScreen(<ConversationList />);

    await user.click(await screen.findByRole('button', { name: `${copy.chat.menu}: Panjang` }));
    await user.click(await screen.findByRole('menuitem', { name: copy.chat.handoff.menu }));

    await waitFor(() => expect(api.handoffConversation).toHaveBeenCalledWith(item.id, 'peringkas'));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/chat/${next.id}`));
    expect(await screen.findByText(copy.chat.handoff.done)).toBeInTheDocument();
  });

  it('Lanjut dengan ringkasan tanpa model yang tersedia: pesan galat, tanpa memanggil server', async () => {
    api.listConversations.mockResolvedValue({
      items: [conversation({ title: 'Panjang' })],
      nextBefore: null,
    });
    api.listModels.mockResolvedValue([]);
    const user = userEvent.setup();
    await renderScreen(<ConversationList />);

    await user.click(await screen.findByRole('button', { name: `${copy.chat.menu}: Panjang` }));
    await user.click(await screen.findByRole('menuitem', { name: copy.chat.handoff.menu }));

    expect(await screen.findByText(copy.chat.handoff.noModel)).toBeInTheDocument();
    expect(api.handoffConversation).not.toHaveBeenCalled();
  });

  it('Esc membatalkan ubah judul tanpa memanggil server', async () => {
    const item = conversation({ title: 'Lama' });
    api.listConversations.mockResolvedValue({ items: [item], nextBefore: null });
    const user = userEvent.setup();
    await renderScreen(<ConversationList />);

    await user.click(await screen.findByRole('button', { name: `${copy.chat.menu}: Lama` }));
    await user.click(await screen.findByRole('menuitem', { name: copy.chat.rename }));
    await user.type(
      await screen.findByRole('textbox', { name: copy.chat.renameLabel }),
      'x{Escape}',
    );

    expect(api.updateConversation).not.toHaveBeenCalled();
    expect(await screen.findByRole('link', { name: 'Lama' })).toBeInTheDocument();
  });

  it('percakapan aktif ditandai aria-current', async () => {
    api.listConversations.mockResolvedValue({
      items: [conversation({ id: CONV, title: 'Aktif' }), conversation({ title: 'Lain' })],
      nextBefore: null,
    });
    await renderScreen(<ConversationList />, `/chat/${CONV}`);

    expect(await screen.findByRole('link', { name: 'Aktif' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Lain' })).not.toHaveAttribute('aria-current');
  });
});
