import type { ResearchDepth } from '@aios/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useState } from 'react';
import { apiErrorMessage } from '../api/errors';
import { useOnline } from '../app/hooks';
import { api } from '../app/services';
import { copy } from '../copy';
import { saveBlob } from '../lib/external';
import { useToastStore } from '../ui/Toaster';

/** Mulai, batalkan, dan ekspor riset. Kesalahan jadi toast dengan langkah berikutnya. */
export function useResearchActions() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const online = useOnline();
  const push = useToastStore((s) => s.push);
  const [busy, setBusy] = useState<'create' | 'cancel' | 'md' | 'pdf' | null>(null);

  const start = useCallback(
    async (question: string, depth: ResearchDepth) => {
      setBusy('create');
      try {
        const job = await api.createResearch(question, depth);
        await queryClient.invalidateQueries({ queryKey: ['research'] });
        await navigate({ to: '/research/$researchId', params: { researchId: job.id } });
      } catch (error) {
        push(apiErrorMessage(error, online), 'danger');
      } finally {
        setBusy(null);
      }
    },
    [queryClient, navigate, online, push],
  );

  const cancel = useCallback(
    async (id: string) => {
      setBusy('cancel');
      try {
        await api.cancelResearch(id);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['researchJob', id] }),
          queryClient.invalidateQueries({ queryKey: ['research'] }),
        ]);
      } catch (error) {
        push(apiErrorMessage(error, online), 'danger');
      } finally {
        setBusy(null);
      }
    },
    [queryClient, online, push],
  );

  const exportReport = useCallback(
    async (id: string, format: 'md' | 'pdf') => {
      setBusy(format);
      try {
        saveBlob(await api.exportResearch(id, format), `riset-${id.slice(0, 8)}.${format}`);
        push(copy.research.exported);
      } catch (error) {
        push(`${copy.research.exportFailed} ${apiErrorMessage(error, online)}`, 'danger');
      } finally {
        setBusy(null);
      }
    },
    [online, push],
  );

  return { busy, start, cancel, exportReport };
}
