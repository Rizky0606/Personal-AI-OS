import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { apiErrorMessage } from '../api/errors';
import { useOnline } from '../app/hooks';
import { api } from '../app/services';
import { useToastStore } from '../ui/Toaster';

/** Menghentikan run dari daftar; kesalahan jadi toast, daftar dimuat ulang setelahnya. */
export function useRunCancel() {
  const queryClient = useQueryClient();
  const online = useOnline();
  const push = useToastStore((s) => s.push);
  const [busyId, setBusyId] = useState<string | null>(null);

  const cancel = useCallback(
    async (runId: string) => {
      setBusyId(runId);
      try {
        await api.cancelRun(runId);
      } catch (error) {
        push(apiErrorMessage(error, online), 'danger');
      } finally {
        setBusyId(null);
        await queryClient.invalidateQueries({ queryKey: ['workspaceRuns'] });
      }
    },
    [online, push, queryClient],
  );

  return { busyId, cancel };
}
