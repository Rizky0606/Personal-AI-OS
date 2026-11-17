import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { useOnline } from '../app/hooks';
import { useToastStore } from '../ui/Toaster';
import { connectorErrorMessage } from './connectorErrors';

/** Jalankan satu aksi konektor: tandai sibuk, segarkan daftar, dan ubah galat jadi toast. */
export function useConnectorActions() {
  const queryClient = useQueryClient();
  const online = useOnline();
  const push = useToastStore((s) => s.push);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['mcpConnectors'] }),
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
        push(connectorErrorMessage(error, online), 'danger');
        return null;
      } finally {
        setBusy(null);
      }
    },
    [online, push, refresh],
  );

  return { busy, run, online, push };
}
