import type { TaskStatus } from '@aios/contracts';
import { useId, type DragEvent, type ReactNode } from 'react';
import { copy } from '../copy';
import { cn } from '../lib/cn';
import { enterDelay } from '../screens/PageLayout';
import { STATUS_DOT } from './board';

export interface KanbanColumnProps {
  status: TaskStatus;
  count: number;
  /** Kartu yang sedang diseret boleh dilepas di kolom ini. */
  accepting: boolean;
  /** Ada kartu yang sedang diseret (kolom yang menerima ditandai). */
  dragActive: boolean;
  /** Penanda sisip di akhir kolom (diseret di atas area kosong kolom). */
  endMarker?: boolean;
  onDragOverColumn?: (status: TaskStatus) => void;
  onDrop: (status: TaskStatus, overId?: string) => void;
  /** Urutan kolom, untuk masuk bertahap. */
  index?: number;
  /** Kartu di kolom ini (`ReactNode` per kartu, sudah berupa `li`). */
  children: ReactNode;
}

/** Satu kolom papan: judul berpenanda warna status dengan jumlah kartu, daftar kartu, dan area lepas. */
export function KanbanColumn({
  status,
  count,
  accepting,
  dragActive,
  endMarker = false,
  onDragOverColumn,
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
    onDragOverColumn?.(status);
  }

  return (
    <section
      aria-labelledby={headingId}
      data-status={status}
      onDragOver={onDragOver}
      onDrop={(event) => {
        if (!accepting) return;
        event.preventDefault();
        onDrop(status);
      }}
      style={enterDelay(index)}
      className={cn(
        'flex min-h-0 min-w-56 flex-1 animate-aios-enter flex-col rounded-panel border bg-surface-2 transition-colors duration-[120ms] ease-aios',
        dragActive && accepting ? 'border-accent bg-accent-soft' : 'border-border',
      )}
    >
      <h3
        id={headingId}
        aria-label={copy.kanban.columnCount(name, count)}
        className="flex items-center justify-between px-3 py-3 text-ui font-medium text-text"
      >
        <span aria-hidden="true" className="flex items-center gap-2">
          <span
            data-testid="column-dot"
            className={cn('size-2 rounded-full', STATUS_DOT[status])}
          />
          {name}
        </span>
        <span aria-hidden="true" className="rounded-full bg-surface px-2 font-mono text-meta tabular-nums text-text-2">
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
        {endMarker ? (
          <li aria-hidden="true" data-testid="drop-marker" className="h-0.5 rounded-badge bg-accent" />
        ) : null}
      </ul>
    </section>
  );
}
