import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { useOnline } from '../app/hooks';
import { useToastStore } from '../ui/Toaster';
import { skillErrorMessage } from './skillErrors';

/** Jalankan satu aksi skill: tandai sibuk, segarkan katalog, dan ubah galat jadi toast. */
export function useSkillActions() {
  const queryClient = useQueryClient();
  const online = useOnline();
  const push = useToastStore((s) => s.push);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['skills'] }),
        queryClient.invalidateQueries({ queryKey: ['skillHermes'] }),
        queryClient.invalidateQueries({ queryKey: ['skillProposals'] }),
        queryClient.invalidateQueries({ queryKey: ['skillCurator'] }),
        queryClient.invalidateQueries({ queryKey: ['progress'] }),
      ]),
    [queryClient],
  );

  const run = useCallback(
    async <T>(
      key: string,
      work: () => Promise<T>,
      success?: string,
      /** Mengembalikan true bila galat sudah ditangani pemanggil (tanpa toast). */
      handled?: (error: unknown) => boolean | Promise<boolean>,
    ): Promise<T | null> => {
      setBusy(key);
      try {
        const result = await work();
        await refresh();
        if (success) push(success);
        return result;
      } catch (error) {
        if (handled && (await handled(error))) return null;
        push(skillErrorMessage(error, online), 'danger');
        return null;
      } finally {
        setBusy(null);
      }
    },
    [online, push, refresh],
  );

  return { busy, run, online, push };
}
