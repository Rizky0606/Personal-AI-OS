import type { Task } from '@aios/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import type { UpdateTaskInput } from '../api/gateway';
import { useOnline } from '../app/hooks';
import { api } from '../app/services';
import { copy } from '../copy';
import { taskErrorMessage } from './errors';
import { useToastStore } from '../ui/Toaster';
import { upsertTask, type Placement } from './board';

/**
 * Aksi pada kartu: pindah, ubah, kerjakan dengan AI, hentikan run. Kesalahan menjadi toast. Server merapikan
 * urutan kolom, jadi setelah tiap perubahan daftar kartu dimuat ulang (selain event task.updated).
 */
export function useTaskActions(projectId: string) {
  const queryClient = useQueryClient();
  const online = useOnline();
  const push = useToastStore((s) => s.push);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['tasks', projectId] }),
    [queryClient, projectId],
  );

  const store = useCallback(
    (task: Task) => {
      queryClient.setQueryData<Task[]>(['tasks', projectId], (old) => upsertTask(old ?? [], task));
    },
    [queryClient, projectId],
  );

  const guarded = useCallback(
    async (key: string, work: () => Promise<void>) => {
      setBusy(key);
      try {
        await work();
      } catch (error) {
        push(taskErrorMessage(error, online), 'danger');
        await refresh();
      } finally {
        setBusy(null);
      }
    },
    [online, push, refresh],
  );

  return {
    busy,
    /** Menyimpan kartu baru. Error dikembalikan ke pemanggil (dialog menampilkannya). */
    create: async (input: { title: string; body: string; agentRole: string | null }) => {
      const task = await api.createTask({ projectId, ...input });
      store(task);
      await refresh();
      return task;
    },
    /** Ubah isi kartu. Error dikembalikan ke pemanggil (dialog menampilkannya). */
    edit: async (id: string, patch: UpdateTaskInput) => {
      const task = await api.updateTask(id, patch);
      store(task);
      await refresh();
      return task;
    },
    move: (id: string, placement: Placement) =>
      guarded(`move:${id}`, async () => {
        store(await api.updateTask(id, placement));
        await refresh();
      }),
    run: (id: string) =>
      guarded(`run:${id}`, async () => {
        const task = await api.runTask(id);
        store(task);
        push(task.runId ? copy.kanban.started : copy.kanban.queuedToast);
        await refresh();
      }),
    cancelRun: (runId: string) =>
      guarded(`cancel:${runId}`, async () => {
        await api.cancelRun(runId);
        push(copy.kanban.runCancelled);
        await refresh();
      }),
  };
}
