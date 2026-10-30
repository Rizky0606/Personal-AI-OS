import type { Task, TaskStatus } from '@aios/contracts';
import { useEffect, useMemo, useState, type DragEvent } from 'react';
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
  const [over, setOver] = useState<{ status: TaskStatus; id?: string } | null>(null);
  const [landedId, setLandedId] = useState<string | null>(null);

  // Tanda "mendarat" hanya sesaat (sama dengan durasi animasi pegas).
  useEffect(() => {
    if (!landedId) return;
    const timer = setTimeout(() => setLandedId(null), 320);
    return () => clearTimeout(timer);
  }, [landedId]);

  function hover(status: TaskStatus, id?: string) {
    setOver((current) =>
      current?.status === status && current.id === id
        ? current
        : id === undefined
          ? { status }
          : { status, id },
    );
  }

  function onDragStart(event: DragEvent, task: Task) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', task.id);
    setDragging(task);
  }

  function drop(target: TaskStatus, overId?: string) {
    const task = dragging;
    setDragging(null);
    setOver(null);
    if (!task || !canDrop(task, target)) return;
    const placement = dropPlacement(board, task.id, target, overId);
    const current = board[task.status].findIndex((t) => t.id === task.id);
    // Dilepas di tempat semula: tidak ada yang berubah.
    if (task.status === target && placement.position === current) return;
    setLandedId(task.id);
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
      className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3"
    >
      {COLUMNS.map((status) => (
        <KanbanColumn
          key={status}
          status={status}
          count={board[status].length}
          accepting={dragging !== null && canDrop(dragging, status)}
          dragActive={dragging !== null}
          endMarker={dragging !== null && over?.status === status && over.id === undefined}
          onDragOverColumn={(s) => hover(s)}
          onDrop={drop}
        >
          {board[status].map((task) => (
            <li
              key={task.id}
              onDragOver={(event) => {
                if (dragging && canDrop(dragging, status)) {
                  event.preventDefault();
                  event.stopPropagation();
                  event.dataTransfer.dropEffect = 'move';
                  hover(status, task.id);
                }
              }}
              onDrop={(event) => {
                if (!dragging || !canDrop(dragging, status)) return;
                event.preventDefault();
                event.stopPropagation();
                drop(status, task.id);
              }}
            >
              {over?.id === task.id && dragging && dragging.id !== task.id ? (
                <div
                  aria-hidden="true"
                  data-testid="drop-marker"
                  className="mb-1 h-0.5 rounded-badge bg-accent"
                />
              ) : null}
              <TaskCard
                task={task}
                roles={roles}
                dragging={dragging?.id === task.id}
                landed={landedId === task.id}
                onOpen={actions.open}
                onRun={actions.run}
                onEdit={actions.edit}
                onMoveTo={(t, target) => actions.move(t, dropPlacement(board, t.id, target))}
                onStep={step}
                onCancelRun={actions.cancelRun}
                onDragStart={onDragStart}
                onDragEnd={() => {
                  setDragging(null);
                  setOver(null);
                }}
              />
            </li>
          ))}
        </KanbanColumn>
      ))}
    </div>
  );
}
