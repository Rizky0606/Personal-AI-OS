import { useNavigate } from '@tanstack/react-router';
import { GitBranch, Rocket, Square } from 'lucide-react';
import { useState } from 'react';
import { apiErrorMessage } from '../api/errors';
import { useWorkspaceRuns } from '../api/queries';
import { useOnline } from '../app/hooks';
import { goConversation } from '../chat/paths';
import { copy } from '../copy';
import { cn } from '../lib/cn';
import { relativeTime } from '../lib/time';
import { Button } from '../ui/Button';
import { useToastStore } from '../ui/Toaster';
import { FleetDialog } from './FleetDialog';
import { StateView, type ViewState } from '../ui/StateView';
import {
  countRuns,
  filterRuns,
  isCancellable,
  RUN_FILTERS,
  statusDotClass,
  type RunFilter,
  type WorkspaceRun,
} from './runs';
import { useRunCancel } from './useRunCancel';

/**
 * Ruang Kerja: semua run coding sekaligus dengan status live, supaya beberapa tugas paralel terlihat tanpa
 * membuka satu per satu. Memilih run membuka percakapan (atau papan kanban untuk run dari kartu).
 */
export function WorkspaceScreen() {
  const query = useWorkspaceRuns();
  const online = useOnline();
  const navigate = useNavigate();
  const { busyId, cancel } = useRunCancel();
  const [filter, setFilter] = useState<RunFilter>('all');
  const [fleetOpen, setFleetOpen] = useState(false);
  const [stopping, setStopping] = useState(false);
  const push = useToastStore((s) => s.push);
  const all = query.data ?? [];
  const items = filterRuns(all, filter);
  const counts = countRuns(all);

  const view: ViewState = query.isPending
    ? 'loading'
    : query.isError && !query.data
      ? online
        ? 'error'
        : 'offline'
      : items.length === 0
        ? 'empty'
        : 'content';

  const running = all.filter((i) => isCancellable(i.run.status));

  /** Menghentikan semua run yang masih berjalan; satu per satu supaya galat satu run tidak menghentikan yang lain. */
  async function stopAll() {
    setStopping(true);
    try {
      for (const item of running) await cancel(item.run.id);
      push(copy.fleet.stopAllDone(running.length));
    } finally {
      setStopping(false);
    }
  }

  function open(item: WorkspaceRun) {
    if (item.run.conversationId) {
      void goConversation(navigate, { id: item.run.conversationId, projectId: item.projectId });
    } else {
      void navigate({ to: '/kanban' });
    }
  }

  return (
    <div className="flex flex-col">
      <div className="flex h-12 items-center justify-between border-b border-border px-4">
        <h2 className="text-section font-semibold text-text">{copy.workspace.title}</h2>
        <div
          role="group"
          aria-label={copy.workspace.filterLabel}
          className="flex items-center gap-1"
        >
          {RUN_FILTERS.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
              className={cn(
                'h-8 rounded-control px-3 text-ui transition-colors duration-[120ms] ease-aios',
                filter === id ? 'bg-accent-soft text-text' : 'text-text-2 hover:bg-surface-2',
              )}
            >
              {copy.workspace.filters[id]} <span className="text-text-3">{counts[id]}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {running.length > 1 ? (
            <Button variant="secondary" disabled={stopping} onClick={() => void stopAll()}>
              <Square size={14} strokeWidth={1.5} aria-hidden="true" />
              {copy.fleet.stopAll}
            </Button>
          ) : null}
          <Button variant="primary" title={copy.fleet.openHint} onClick={() => setFleetOpen(true)}>
            <Rocket size={14} strokeWidth={1.5} aria-hidden="true" />
            {copy.fleet.open}
          </Button>
        </div>
      </div>
      <FleetDialog open={fleetOpen} onOpenChange={setFleetOpen} />
      <StateView
        state={view}
        loadingLabel={copy.workspace.loading}
        emptyMessage={all.length === 0 ? copy.workspace.empty : copy.workspace.emptyFilter}
        emptyAction={
          all.length === 0 ? (
            <Button variant="secondary" onClick={() => void navigate({ to: '/kanban' })}>
              {copy.workspace.openKanban}
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => setFilter('all')}>
              {copy.workspace.showAll}
            </Button>
          )
        }
        errorMessage={query.isError ? apiErrorMessage(query.error, online) : ''}
        offlineMessage={copy.states.offline}
        retryLabel={copy.states.retry}
        onRetry={() => void query.refetch()}
      >
        <ul aria-label={copy.workspace.title}>
          {items.map((item) => (
            <li
              key={item.run.id}
              className="flex items-center gap-3 border-b border-border px-4 py-2 transition-colors duration-[120ms] ease-aios hover:bg-surface-2"
            >
              <span
                role="img"
                aria-label={copy.runStatus[item.run.status]}
                className={cn('size-2 shrink-0 rounded-full', statusDotClass(item.run.status))}
              />
              <button
                type="button"
                onClick={() => open(item)}
                aria-label={`${copy.workspace.open}: ${item.title || copy.workspace.untitled}`}
                className="flex min-w-0 flex-1 flex-col items-start text-left"
              >
                <span className="w-full truncate text-ui text-text">
                  {item.title || copy.workspace.untitled}
                </span>
                <span className="flex w-full items-center gap-2 truncate text-meta text-text-3">
                  <span>{copy.runStatus[item.run.status]}</span>
                  {item.projectName ? <span>· {item.projectName}</span> : null}
                  {item.run.branch ? (
                    <span className="inline-flex items-center gap-1">
                      · <GitBranch size={12} strokeWidth={1.5} aria-hidden="true" />
                      {item.run.branch}
                    </span>
                  ) : null}
                  <span>· {relativeTime(item.run.updatedAt)}</span>
                </span>
              </button>
              {isCancellable(item.run.status) ? (
                <Button
                  variant="secondary"
                  disabled={busyId === item.run.id}
                  aria-label={`${copy.workspace.stop}: ${item.title || copy.workspace.untitled}`}
                  onClick={() => void cancel(item.run.id)}
                >
                  <Square size={14} strokeWidth={1.5} aria-hidden="true" />
                  {copy.workspace.stop}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </StateView>
    </div>
  );
}
