import type { TaskStatus } from '@aios/contracts';
import { useId, type DragEvent, type ReactNode } from 'react';
import { copy } from '../copy';
import { cn } from '../lib/cn';
import { enterDelay } from '../screens/PageLayout';

export interface KanbanColumnProps {
  status: TaskStatus;
  count: number;
  /** Kartu yang sedang diseret boleh dilepas di kolom ini. */
  accepting: boolean;
  /** Ada kartu yang sedang diseret (kolom yang menerima ditandai). */
  dragActive: boolean;
  onDrop: (status: TaskStatus, overId?: string) => void;
  /** Urutan kolom, untuk masuk bertahap. */
  index?: number;
  /** Kartu di kolom ini (`ReactNode` per kartu, sudah berupa `li`). */
  children: ReactNode;
}

/** Satu kolom papan: judul dengan jumlah kartu, daftar kartu, dan area lepas. */
export function KanbanColumn({
  status,
  count,
  accepting,
  dragActive,
  onDrop,
  index = 0,
  children,
}: KanbanColumnProps) {
  const headingId = useId();
  const name = copy.kanban.columns[status];

  function onDragOver(event: DragEvent) {
    if (!accepting) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }

  return (
    <section
      aria-labelledby={headingId}
      onDragOver={onDragOver}
      onDrop={(event) => {
        if (!accepting) return;
        event.preventDefault();
        onDrop(status);
      }}
      style={enterDelay(index)}
      className={cn(
        'flex min-h-0 min-w-56 flex-1 animate-aios-enter flex-col rounded-panel border bg-surface-2 transition-colors duration-[120ms] ease-aios',
        dragActive && accepting ? 'border-accent' : 'border-border',
      )}
    >
      <h3
        id={headingId}
        aria-label={copy.kanban.columnCount(name, count)}
        className="flex items-center justify-between px-3 py-3 text-ui font-medium text-text"
      >
        <span aria-hidden="true">{name}</span>
        <span
          aria-hidden="true"
          className="rounded-full bg-surface px-2 font-mono text-meta tabular-nums text-text-2"
        >
          {count}
        </span>
      </h3>
      <ul className="flex min-h-16 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {count === 0 ? (
          <li className="px-1 py-2 text-meta text-text-3">
            {dragActive && accepting ? copy.kanban.dropHere : copy.kanban.columnEmpty}
          </li>
        ) : (
          children
        )}
      </ul>
    </section>
  );
}
