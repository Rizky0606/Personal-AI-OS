import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { apiErrorMessage } from '../api/errors';
import { useOnline } from '../app/hooks';
import { api } from '../app/services';
import { copy } from '../copy';
import { useToastStore } from '../ui/Toaster';

/**
 * Tambah, ubah, aktif/nonaktif, dan hapus memori. Kesalahan jadi toast dan aksi mengembalikan false, supaya
 * editor atau dialog tetap terbuka dan isian tidak hilang.
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
        await queryClient.invalidateQueries({ queryKey: ['memories'] });
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
    remove: (id: string) => guarded(`remove:${id}`, () => api.deleteMemory(id), m.removed),
  };
}
