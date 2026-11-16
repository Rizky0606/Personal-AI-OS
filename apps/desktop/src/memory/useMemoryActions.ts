import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { apiErrorMessage } from '../api/errors';
import { useOnline } from '../app/hooks';
import { api } from '../app/services';
import { copy } from '../copy';
import { useToastStore } from '../ui/Toaster';

/**
 * Tambah, ubah, aktif/nonaktif, sematkan, dan hapus memori, plus setujui/tolak usulan memori dari chat. Kesalahan
 * jadi toast dan aksi mengembalikan false, supaya editor atau dialog tetap terbuka dan isian tidak hilang.
 */
export function useMemoryActions() {
  const queryClient = useQueryClient();
  const online = useOnline();
  const push = useToastStore((s) => s.push);
  const [busy, setBusy] = useState<string | null>(null);

  const guarded = useCallback(
    async (key: string, work: () => Promise<unknown>, done?: string): Promise<boolean> => {
      setBusy(key);
      try {
        await work();
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['memories'] }),
          queryClient.invalidateQueries({ queryKey: ['memoryProposals'] }),
        ]);
        if (done) push(done);
        return true;
      } catch (error) {
        push(apiErrorMessage(error, online), 'danger');
        return false;
      } finally {
        setBusy(null);
      }
    },
    [online, push, queryClient],
  );

  const m = copy.memory;
  return {
    busy,
    create: (text: string) => guarded('create', () => api.createMemory(text.trim()), m.saved),
    edit: (id: string, text: string) =>
      guarded(`edit:${id}`, () => api.updateMemory(id, { text: text.trim() }), m.updated),
    setEnabled: (id: string, enabled: boolean) =>
      guarded(`toggle:${id}`, () => api.updateMemory(id, { enabled })),
    setPinned: (id: string, pinned: boolean) =>
      guarded(`pin:${id}`, () => api.updateMemory(id, { pinned }), pinned ? m.pinned : m.unpinned),
    remove: (id: string) => guarded(`remove:${id}`, () => api.deleteMemory(id), m.removed),
    approveProposal: (id: string, text?: string) =>
      guarded(`proposal:${id}`, () => api.approveMemoryProposal(id, text), m.proposalApproved),
    rejectProposal: (id: string) =>
      guarded(`proposal:${id}`, () => api.rejectMemoryProposal(id), m.proposalRejected),
  };
}
