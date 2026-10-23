import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { apiErrorMessage } from '../api/errors';
import { useOnline } from '../app/hooks';
import { api } from '../app/services';
import { useToastStore } from '../ui/Toaster';

/** Ubah judul, sematkan, dan arsipkan percakapan; daftar disegarkan setelah server menjawab. */
export function useConversationActions(activeId?: string) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const online = useOnline();
  const push = useToastStore((s) => s.push);

  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      try {
        await action();
        await queryClient.invalidateQueries({ queryKey: ['conversations'] });
      } catch (error) {
        push(apiErrorMessage(error, online), 'danger');
      }
    },
    [queryClient, push, online],
  );

  return {
    rename: (id: string, title: string) => run(() => api.updateConversation(id, { title })),
    setPinned: (id: string, pinned: boolean) => run(() => api.updateConversation(id, { pinned })),
    archive: (id: string) =>
      run(async () => {
        await api.archiveConversation(id);
        if (id === activeId) await navigate({ to: '/' });
      }),
  };
}
