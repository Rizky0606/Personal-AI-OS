import type { Task } from '@aios/contracts';
import { Plus, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { TaskProposal } from '../api/gateway';
import { useRoles, useTasks } from '../api/queries';
import { useOnline } from '../app/hooks';
import { copy } from '../copy';
import { taskErrorMessage } from './errors';
import { useUiStore } from '../state/uiStore';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { StateView, type ViewState } from '../ui/StateView';
import { useToastStore } from '../ui/Toaster';
import { useProjects } from '../worker/hooks';
import { BreakdownDialog } from './BreakdownDialog';
import { KanbanBoard } from './KanbanBoard';
import { TaskDialog } from './TaskDialog';
import { useTaskActions } from './useTaskActions';

type Dialog = { kind: 'task'; task?: Task } | { kind: 'breakdown' } | null;

/** Papan kanban satu project: Backlog, Todo, Running, Review, Done. */
export function KanbanScreen() {
  const projectId = useUiStore((s) => s.activeProjectId);
  const projects = useProjects();
  const project = projects.data?.find((p) => p.id === projectId);

  if (!projectId || (projects.isSuccess && !project)) {
    return (
      <div className="flex flex-col">
        <Header title={copy.kanban.title} />
        <EmptyState message={copy.kanban.noProject} />
      </div>
    );
  }
  return <Board projectId={projectId} projectName={project?.name} />;
}

function Header({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
      <h2 className="min-w-0 truncate text-section font-semibold text-text">{title}</h2>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

function Board({ projectId, projectName }: { projectId: string; projectName: string | undefined }) {
  const query = useTasks(projectId);
  const roles = useRoles();
  const online = useOnline();
  const openReview = useUiStore((s) => s.openReview);
  const push = useToastStore((s) => s.push);
  const actions = useTaskActions(projectId);
  const [dialog, setDialog] = useState<Dialog>(null);
  const tasks = useMemo(() => query.data ?? [], [query.data]);

  const view: ViewState = query.isPending
    ? 'loading'
    : query.isError && !query.data
      ? online
        ? 'error'
        : 'offline'
      : tasks.length === 0
        ? 'empty'
        : 'content';

  const newButton = (
    <Button variant="primary" onClick={() => setDialog({ kind: 'task' })}>
      <Plus size={14} strokeWidth={1.5} aria-hidden="true" />
      {copy.kanban.newTask}
    </Button>
  );
  const breakdownButton = (
    <Button variant="secondary" onClick={() => setDialog({ kind: 'breakdown' })}>
      <Sparkles size={14} strokeWidth={1.5} aria-hidden="true" />
      {copy.kanban.breakdown}
    </Button>
  );

  async function saveProposals(proposals: TaskProposal[]) {
    for (const item of proposals) {
      await actions.create({ title: item.title, body: item.body, agentRole: item.agentRole });
    }
    push(copy.kanban.breakdownDialog.saved(proposals.length));
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Header title={projectName ? `${copy.kanban.title} · ${projectName}` : copy.kanban.title}>
        {breakdownButton}
        {newButton}
      </Header>
      <StateView
        state={view}
        loadingLabel={copy.kanban.loading}
        emptyMessage={copy.kanban.empty}
        emptyAction={
          <div className="flex gap-2">
            {breakdownButton}
            {newButton}
          </div>
        }
        errorMessage={query.isError ? taskErrorMessage(query.error, online) : ''}
        offlineMessage={copy.states.offline}
        retryLabel={copy.states.retry}
        onRetry={() => void query.refetch()}
      >
        <KanbanBoard
          tasks={tasks}
          roles={roles.data ?? []}
          actions={{
            open: (task) => {
              if (task.status === 'review' && task.runId) openReview(task.runId);
              else setDialog({ kind: 'task', task });
            },
            run: (task) => void actions.run(task.id),
            edit: (task) => setDialog({ kind: 'task', task }),
            move: (task, placement) => void actions.move(task.id, placement),
            cancelRun: (runId) => void actions.cancelRun(runId),
          }}
        />
      </StateView>

      {dialog?.kind === 'task' ? (
        <TaskDialog
          key={dialog.task?.id ?? 'baru'}
          open
          onOpenChange={(open) => !open && setDialog(null)}
          task={dialog.task}
          onSave={async (input) => {
            if (dialog.task) await actions.edit(dialog.task.id, input);
            else {
              await actions.create(input);
              push(copy.kanban.dialog.created);
            }
          }}
        />
      ) : null}
      {dialog?.kind === 'breakdown' ? (
        <BreakdownDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          projectId={projectId}
          roles={roles.data ?? []}
          onSave={saveProposals}
        />
      ) : null}
    </div>
  );
}
