import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useState } from 'react';
import { apiErrorMessage } from '../api/errors';
import type { CreateScheduleInput } from '../api/gateway';
import { useOnline } from '../app/hooks';
import { api } from '../app/services';
import { copy } from '../copy';
import { useToastStore } from '../ui/Toaster';

/** Buat, aktif/nonaktif, jalankan sekarang, dan hapus jadwal. Kesalahan jadi toast; `create` melempar ulang untuk dialog. */
export function useScheduleActions() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const online = useOnline();
  const push = useToastStore((s) => s.push);
  const [busy, setBusy] = useState<string | null>(null);

  const guarded = useCallback(
    async (key: string, work: () => Promise<void>) => {
      setBusy(key);
      try {
        await work();
      } catch (error) {
        push(apiErrorMessage(error, online), 'danger');
      } finally {
        setBusy(null);
      }
    },
    [online, push],
  );

  const refresh = useCallback(
    (id?: string) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['schedules'] }),
        ...(id ? [queryClient.invalidateQueries({ queryKey: ['scheduleRuns', id] })] : []),
      ]),
    [queryClient],
  );

  return {
    busy,
    /** Menyimpan jadwal yang sudah dikonfirmasi. Error dikembalikan ke pemanggil (dialog menampilkannya). */
    create: async (input: CreateScheduleInput) => {
      const schedule = await api.createSchedule(input);
      await refresh();
      push(copy.schedules.dialog.saved);
      return schedule;
    },
    setEnabled: (id: string, enabled: boolean) =>
      guarded(`toggle:${id}`, async () => {
        await api.updateSchedule(id, { enabled });
        await refresh(id);
      }),
    setNotify: (id: string, notify: 'always' | 'on_change') =>
      guarded(`notify:${id}`, async () => {
        await api.updateSchedule(id, { notify });
        await refresh(id);
      }),
    runNow: (id: string) =>
      guarded(`run:${id}`, async () => {
        await api.runScheduleNow(id);
        push(copy.schedules.detail.runStarted);
        await refresh(id);
      }),
    remove: (id: string) =>
      guarded(`delete:${id}`, async () => {
        await api.deleteSchedule(id);
        await refresh();
        push(copy.schedules.detail.deleted);
        await navigate({ to: '/schedules' });
      }),
  };
}
