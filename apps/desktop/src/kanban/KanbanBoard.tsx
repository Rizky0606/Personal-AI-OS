import type { Task, TaskStatus } from '@aios/contracts';
import { useMemo, useState, type DragEvent } from 'react';
import type { RoleInfo } from '../api/gateway';
import { copy } from '../copy';
import {
  COLUMNS,
  canDrop,
  dropPlacement,
  groupTasks,
  stepPlacement,
  type Direction,
  type Placement,
} from './board';
import { KanbanColumn } from './KanbanColumn';
import { TaskCard } from './TaskCard';

export interface BoardActions {
  open: (task: Task) => void;
  run: (task: Task) => void;
  edit: (task: Task) => void;
  move: (task: Task, placement: Placement) => void;
  cancelRun: (runId: string) => void;
}

export interface KanbanBoardProps {
  tasks: Task[];
  roles: RoleInfo[];
  actions: BoardActions;
}

/**
 * Lima kolom dengan seret-lepas (HTML5). Alternatif tanpa mouse: Alt + panah pada judul kartu, atau menu
 * aksi kartu. Running dan Review tidak menerima lepasan; keduanya diisi sistem.
 */
export function KanbanBoard({ tasks, roles, actions }: KanbanBoardProps) {
  const board = useMemo(() => groupTasks(tasks), [tasks]);
  const [dragging, setDragging] = useState<Task | null>(null);

  function onDragStart(event: DragEvent, task: Task) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', task.id);
    setDragging(task);
  }

  function drop(target: TaskStatus, overId?: string) {
    const task = dragging;
    setDragging(null);
    if (!task || !canDrop(task, target)) return;
    const placement = dropPlacement(board, task.id, target, overId);
    const current = board[task.status].findIndex((t) => t.id === task.id);
    // Dilepas di tempat semula: tidak ada yang berubah.
    if (task.status === target && placement.position === current) return;
    actions.move(task, placement);
  }

  function step(task: Task, direction: Direction) {
    const placement = stepPlacement(board, task, direction);
    if (placement) actions.move(task, placement);
  }

  return (
    <div
      role="group"
      aria-label={copy.kanban.board}
      className="flex min-h-0 flex-1 gap-4 overflow-x-auto px-6 pb-6"
    >
      {COLUMNS.map((status, index) => (
        <KanbanColumn
          key={status}
          status={status}
          index={index}
          count={board[status].length}
          accepting={dragging !== null && canDrop(dragging, status)}
          dragActive={dragging !== null}
          onDrop={drop}
        >
          {board[status].map((task) => (
            <li
              key={task.id}
              onDragOver={(event) => {
                if (dragging && canDrop(dragging, status)) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                }
              }}
              onDrop={(event) => {
                if (!dragging || !canDrop(dragging, status)) return;
                event.preventDefault();
                event.stopPropagation();
                drop(status, task.id);
              }}
            >
              <TaskCard
                task={task}
                roles={roles}
                dragging={dragging?.id === task.id}
                onOpen={actions.open}
                onRun={actions.run}
                onEdit={actions.edit}
                onMoveTo={(t, target) => actions.move(t, dropPlacement(board, t.id, target))}
                onStep={step}
                onCancelRun={actions.cancelRun}
                onDragStart={onDragStart}
                onDragEnd={() => setDragging(null)}
              />
            </li>
          ))}
        </KanbanColumn>
      ))}
    </div>
  );
}
