import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { apiErrorMessage } from '../api/errors';
import { useOnline } from '../app/hooks';
import { api } from '../app/services';
import { copy } from '../copy';
import { useUiStore } from '../state/uiStore';
import { useToastStore } from '../ui/Toaster';
import { goConversation, goHome } from './paths';

/** Ubah judul, sematkan, arsipkan, dan hapus percakapan; daftar disegarkan setelah server menjawab. */
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
        if (id === activeId) await goHome(navigate, useUiStore.getState().activeProjectId);
      }),
    /** Meringkas percakapan dengan model pilihan (atau model pertama), lalu membuka percakapan lanjutan. */
    handoff: (id: string) =>
      run(async () => {
        const model = useUiStore.getState().model ?? (await api.listModels())[0]?.id;
        if (!model) {
          push(copy.chat.handoff.noModel, 'danger');
          return;
        }
        push(copy.chat.handoff.working, 'info');
        const created = await api.handoffConversation(id, model);
        await goConversation(navigate, created);
        push(copy.chat.handoff.done);
      }),
    remove: (id: string) =>
      run(async () => {
        await api.deleteConversation(id);
        if (id === activeId) await goHome(navigate, useUiStore.getState().activeProjectId);
        push(copy.chat.deleted);
      }),
  };
}
