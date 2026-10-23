import type { ServerEvent, Task } from '@aios/contracts';
import type { QueryClient } from '@tanstack/react-query';
import { upsertTask } from '../kanban/board';
import { useToastStore } from '../ui/Toaster';

/** Event channel `user`: menyegarkan layar yang terbuka dan menampilkan notifikasi. */
export function handleUserEvent(event: ServerEvent, queryClient: QueryClient): void {
  switch (event.type) {
    case 'schedule.result':
      void queryClient.invalidateQueries({ queryKey: ['schedules'] });
      void queryClient.invalidateQueries({ queryKey: ['scheduleRuns', event.scheduleId] });
      void queryClient.invalidateQueries({ queryKey: ['messages'] });
      break;
    case 'task.updated': {
      // Event membawa kartu terbaru; urutan kolom lain dirapikan server, jadi daftar dimuat ulang juga.
      const { task } = event;
      queryClient.setQueryData<Task[]>(['tasks', task.projectId], (old) =>
        old ? upsertTask(old, task) : old,
      );
      void queryClient.invalidateQueries({ queryKey: ['tasks', task.projectId] });
      break;
    }
    case 'notification':
      useToastStore.getState().push(event.title, event.level === 'info' ? 'info' : 'danger');
      break;
    case 'research.completed':
      void queryClient.invalidateQueries({ queryKey: ['research'] });
      void queryClient.invalidateQueries({ queryKey: ['researchJob', event.researchId] });
      break;
    default:
      break;
  }
}
