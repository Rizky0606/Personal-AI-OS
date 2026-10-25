import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useState } from 'react';
import { apiErrorMessage } from '../api/errors';
import { useOnline } from '../app/hooks';
import { api } from '../app/services';
import { copy } from '../copy';
import { useToastStore } from '../ui/Toaster';

/** Buat ruang, tambah/keluarkan dokumen, mulai chat, dan hapus ruang. Kesalahan jadi toast. */
export function useSpaceActions() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const online = useOnline();
  const push = useToastStore((s) => s.push);
  const [busy, setBusy] = useState<string | null>(null);
  const s = copy.spaces;

  const guarded = useCallback(
    async <T>(key: string, work: () => Promise<T>): Promise<T | null> => {
      setBusy(key);
      try {
        return await work();
      } catch (error) {
        push(apiErrorMessage(error, online), 'danger');
        return null;
      } finally {
        setBusy(null);
      }
    },
    [online, push],
  );

  const refresh = (spaceId?: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['spaces'] }),
      ...(spaceId
        ? [
            queryClient.invalidateQueries({ queryKey: ['spaceDocuments', spaceId] }),
            queryClient.invalidateQueries({ queryKey: ['spaceConversations', spaceId] }),
          ]
        : []),
    ]);

  return {
    busy,
    create: (name: string, description: string) =>
      guarded('create', async () => {
        const space = await api.createSpace(name.trim(), description.trim());
        await refresh();
        push(s.created);
        await navigate({ to: '/spaces/$spaceId', params: { spaceId: space.id } });
        return space;
      }),
    /** Unggah lalu indeks beberapa berkas berurutan; satu yang gagal tidak menghentikan sisanya. */
    addFiles: async (spaceId: string, files: readonly File[]) => {
      for (const file of files) {
        const done = await guarded(`add:${file.name}`, async () => {
          const record = await api.uploadFile(file);
          return api.addSpaceDocument(spaceId, record.id);
        });
        if (done) push(s.added(done.name));
      }
      await refresh(spaceId);
    },
    removeDocument: (spaceId: string, documentId: string) =>
      guarded(`remove:${documentId}`, async () => {
        await api.deleteSpaceDocument(spaceId, documentId);
        await refresh(spaceId);
        push(s.removed);
      }),
    newChat: (spaceId: string) =>
      guarded('chat', async () => {
        const conversation = await api.createConversation('windows', undefined, spaceId);
        await queryClient.invalidateQueries({ queryKey: ['conversations'] });
        await navigate({
          to: '/chat/$conversationId',
          params: { conversationId: conversation.id },
        });
      }),
    remove: (spaceId: string) =>
      guarded('delete', async () => {
        await api.deleteSpace(spaceId);
        await refresh();
        push(s.deleted);
        await navigate({ to: '/spaces' });
      }),
  };
}
