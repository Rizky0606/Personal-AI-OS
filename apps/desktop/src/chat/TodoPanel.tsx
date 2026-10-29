import type { TodoPhase, TodoStatus } from '@aios/contracts';
import { Check, Circle, CircleSlash, Loader, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { copy } from '../copy';
import { cn } from '../lib/cn';

const ICON = { size: 14, strokeWidth: 1.5, 'aria-hidden': true } as const;

const statusIcon: Record<TodoStatus, ReactNode> = {
  pending: <Circle {...ICON} className="text-text-3" />,
  in_progress: <Loader {...ICON} className="animate-spin text-accent" />,
  completed: <Check {...ICON} className="text-success" />,
  abandoned: <CircleSlash {...ICON} className="text-text-3" />,
  blocked: <TriangleAlert {...ICON} className="text-warning" />,
};

/** Rencana agent langsung (tool `todo` omp): kemajuan keseluruhan dan daftar tugas per tahap. */
export function TodoPanel({ phases }: { phases: readonly TodoPhase[] }) {
  const tasks = phases.flatMap((p) => p.tasks);
  if (tasks.length === 0) return null;
  const done = tasks.filter((t) => t.status === 'completed' || t.status === 'abandoned').length;
  const percent = Math.round((done / tasks.length) * 100);
  const t = copy.chat.todo;
  return (
    <section
      aria-label={t.title}
      className="flex animate-aios-enter flex-col gap-2 rounded-control border border-border bg-surface-2 p-3"
    >
      <header className="flex items-center gap-3">
        <h3 className="text-ui font-semibold text-text">{t.title}</h3>
        <div
          role="progressbar"
          aria-label={t.title}
          aria-valuemin={0}
          aria-valuemax={tasks.length}
          aria-valuenow={done}
          className="h-1 flex-1 overflow-hidden rounded-full bg-border"
        >
          <div
            className="aios-primary h-full rounded-full transition-[width] duration-[320ms] ease-aios"
            style={{ width: `${percent}%` }}
          />
        </div>
        <span className="font-mono text-meta text-text-2">{t.progress(done, tasks.length)}</span>
      </header>
      {phases.map((phase, i) =>
        phase.tasks.length === 0 ? null : (
          <div key={`${phase.name}-${i}`} className="flex flex-col gap-1">
            {phases.length > 1 ? (
              <h4 className="text-caption font-medium text-text-3">{phase.name}</h4>
            ) : null}
            <ul className="flex flex-col gap-1">
              {phase.tasks.map((task, j) => (
                <li
                  key={`${task.content}-${j}`}
                  className={cn(
                    'flex items-start gap-2 text-ui',
                    task.status === 'completed' || task.status === 'abandoned'
                      ? 'text-text-3'
                      : 'text-text',
                    task.status === 'abandoned' && 'line-through',
                  )}
                >
                  <span className="mt-0.5 shrink-0">{statusIcon[task.status]}</span>
                  <span className="min-w-0">
                    <span className="sr-only">{t.status[task.status]}: </span>
                    {task.content}
                    {task.status === 'blocked' && task.blocker ? (
                      <span className="block text-meta text-warning">{task.blocker}</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ),
      )}
    </section>
  );
}
