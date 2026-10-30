import type { Task } from '@aios/contracts';
import { MoreHorizontal } from 'lucide-react';
import type { DragEvent, KeyboardEvent } from 'react';
import type { RoleInfo } from '../api/gateway';
import { AgentOrb, orbStateOf } from '../chat/AgentOrb';
import { RoleChip } from '../chat/RoleChip';
import { useLiveRun } from '../app/hooks';
import { buildActivity } from '../realtime/activity';
import { copy } from '../copy';
import { cn } from '../lib/cn';
import { ActionMenu, type MenuAction } from '../ui/ActionMenu';
import { IconButton } from '../ui/IconButton';
import {
  STATUS_DOT,
  USER_COLUMNS,
  formatDiffStat,
  isLocked,
  isQueued,
  isRunnable,
  type Direction,
} from './board';

export interface TaskCardProps {
  task: Task;
  /** Daftar agent, untuk nama yang ditampilkan di chip. */
  roles: RoleInfo[];
  /** Kartu ini sedang diseret. */
  dragging: boolean;
  onOpen: (task: Task) => void;
  onRun: (task: Task) => void;
  onEdit: (task: Task) => void;
  onMoveTo: (task: Task, status: Task['status']) => void;
  onStep: (task: Task, direction: Direction) => void;
  onCancelRun: (runId: string) => void;
  onDragStart: (event: DragEvent, task: Task) => void;
  onDragEnd: () => void;
  /** Baru dilepas di kolom ini: animasi mendarat singkat. */
  landed?: boolean;
}

/** Orb kecil dan fase singkat untuk kartu yang sedang dikerjakan agent (dari buildActivity bila run live ada). */
function AgentStatus({ runId }: { runId: string }) {
  const live = useLiveRun(runId);
  const phase = live ? buildActivity(live, live.lastEventAt ?? live.startedAt ?? 0).phase : 'tool';
  return (
    <p className="flex items-center gap-2 text-meta text-text-2">
      <AgentOrb state={orbStateOf(phase)} size={16} />
      {copy.runActivity.ui.phase[phase]}
    </p>
  );
}

/** Titik status menurut kolom; antrean berupa cincin kosong. Teksnya ikut dibacakan (warna bukan satu-satunya penanda). */
function statusOf(task: Task): { dot: string; text: string } {
  if (isQueued(task)) return { dot: 'border border-text-2', text: copy.kanban.status.queued };
  return { dot: STATUS_DOT[task.status], text: copy.kanban.status[task.status] };
}

const ARROWS: Record<string, Direction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

/**
 * Kartu kanban (DESIGN_SYSTEM.md): judul, chip role, titik status, branch, diff stat mono. Bisa diseret;
 * alternatif keyboard: Alt + panah pada judul, atau menu aksi.
 */
export function TaskCard({
  task,
  roles,
  dragging,
  onOpen,
  onRun,
  onEdit,
  onMoveTo,
  onStep,
  onCancelRun,
  onDragStart,
  onDragEnd,
  landed = false,
}: TaskCardProps) {
  const status = statusOf(task);
  const locked = isLocked(task);
  const queued = isQueued(task);
  const diff = formatDiffStat(task.diffStat);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const direction = ARROWS[event.key];
    if (!event.altKey || !direction) return;
    event.preventDefault();
    onStep(task, direction);
  }

  const actions: MenuAction[] = [];
  if (isRunnable(task)) {
    actions.push({ id: 'run', label: copy.kanban.runWithAi, onSelect: () => onRun(task) });
  }
  if (task.status === 'review' && task.runId) {
    actions.push({ id: 'review', label: copy.kanban.openReview, onSelect: () => onOpen(task) });
  }
  if (locked && task.runId) {
    const runId = task.runId;
    actions.push({
      id: 'cancel',
      label: copy.kanban.cancelRun,
      danger: true,
      onSelect: () => onCancelRun(runId),
    });
  }
  actions.push({ id: 'edit', label: copy.kanban.edit, onSelect: () => onEdit(task) });
  if (!locked) {
    if (queued) {
      actions.push({
        id: 'dequeue',
        label: copy.kanban.dequeue,
        onSelect: () => onMoveTo(task, 'todo'),
      });
    }
    for (const target of USER_COLUMNS.filter((c) => c !== task.status)) {
      actions.push({
        id: `to-${target}`,
        label: copy.kanban.moveTo(copy.kanban.columns[target]),
        onSelect: () => onMoveTo(task, target),
      });
    }
    actions.push(
      { id: 'up', label: copy.kanban.moveUp, onSelect: () => onStep(task, 'up') },
      { id: 'down', label: copy.kanban.moveDown, onSelect: () => onStep(task, 'down') },
    );
  }

  return (
    <article
      draggable={!locked}
      onDragStart={(event) => onDragStart(event, task)}
      onDragEnd={onDragEnd}
      aria-label={task.title}
      data-landed={landed ? 'true' : undefined}
      className={cn(
        'flex flex-col gap-2 rounded-panel border border-border bg-surface p-3 transition duration-[180ms] ease-spring',
        'focus-within:border-border-strong hover:-translate-y-0.5 hover:border-border-strong hover:shadow-lift',
        !locked && 'cursor-grab',
        dragging && 'opacity-50',
        landed && 'aios-land',
      )}
    >
      <div className="flex items-start gap-2">
        <span
          aria-hidden="true"
          className={cn('mt-1.5 size-2 shrink-0 rounded-full', status.dot)}
        />
        <button
          type="button"
          onClick={() => onOpen(task)}
          onKeyDown={onKeyDown}
          aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight"
          title={copy.kanban.cardHint}
          className="min-w-0 flex-1 text-left text-ui font-medium text-text"
        >
          <span className="sr-only">{status.text}: </span>
          <span className="line-clamp-2">{task.title}</span>
        </button>
        <ActionMenu
          trigger={
            <IconButton label={copy.kanban.cardMenu(task.title)} className="-mt-1 -mr-1">
              <MoreHorizontal size={16} strokeWidth={1.5} aria-hidden="true" />
            </IconButton>
          }
          actions={actions}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {task.agentRole ? (
          <RoleChip role={task.agentRole} roles={roles} />
        ) : (
          <span className="inline-flex h-6 items-center rounded-badge bg-surface-2 px-2 text-meta text-text-3">
            {copy.kanban.role.auto}
          </span>
        )}
        {queued ? (
          <span className="inline-flex h-6 items-center rounded-badge border border-border px-2 text-meta text-text-2">
            {copy.kanban.queued}
          </span>
        ) : null}
        {diff ? <span className="font-mono text-meta tabular-nums text-text-2">{diff}</span> : null}
      </div>

      {task.status === 'running' && task.runId ? <AgentStatus runId={task.runId} /> : null}

      {task.branch ? (
        <p className="truncate font-mono text-caption text-text-3" title={task.branch}>
          {task.branch}
        </p>
      ) : null}
    </article>
  );
}
