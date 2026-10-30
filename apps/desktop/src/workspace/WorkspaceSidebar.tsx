import { Link, useParams } from '@tanstack/react-router';
import { ChevronRight, Plus, Settings2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { apiErrorMessage } from '../api/errors';
import { useConversations, useWorkspaceRuns } from '../api/queries';
import { useOnline } from '../app/hooks';
import { ConversationRow } from '../chat/ConversationRow';
import { useConversationActions } from '../chat/useConversationActions';
import { AddProjectDialog } from '../projects/AddProjectDialog';
import { copy } from '../copy';
import { cn } from '../lib/cn';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { StateView, type ViewState } from '../ui/StateView';
import { useProjects } from '../worker/hooks';
import { isLiveRun, needsAttention, statusDotClass, type WorkspaceRun } from './runs';

/** Run terbaru yang belum final per project, untuk penanda status di sidebar. */
function liveRunOf(runs: WorkspaceRun[], projectId: string): WorkspaceRun | undefined {
  return runs.find((r) => r.projectId === projectId && isLiveRun(r.run.status));
}

function ProjectGroup({
  project,
  selected,
  activeConversationId,
  live,
}: {
  project: { id: string; name: string };
  selected: boolean;
  activeConversationId: string | undefined;
  live: WorkspaceRun | undefined;
}) {
  const [open, setOpen] = useState(selected);
  const query = useConversations(open ? project.id : null);
  const actions = useConversationActions(activeConversationId);
  const items = useMemo(() => {
    const all = (query.data?.pages.flatMap((page) => page.items) ?? []).filter(
      (c) => c.projectId === project.id,
    );
    return [...all.filter((c) => c.pinned), ...all.filter((c) => !c.pinned)];
  }, [query.data, project.id]);

  return (
    <li>
      <div
        className={cn(
          'group flex min-h-9 items-center gap-1 rounded-control pr-1 pl-1 transition-colors duration-[120ms] ease-aios',
          selected ? 'aios-active-wash' : 'hover:bg-surface-2',
        )}
      >
        <IconButton
          label={`${open ? copy.workspace.collapse : copy.workspace.expand}: ${project.name}`}
          onClick={() => setOpen((v) => !v)}
        >
          <ChevronRight
            size={14}
            strokeWidth={1.5}
            aria-hidden="true"
            className={cn('transition-transform duration-[120ms]', open && 'rotate-90')}
          />
        </IconButton>
        <Link
          to="/workspace/$projectId"
          params={{ projectId: project.id }}
          aria-current={selected && !activeConversationId ? 'page' : undefined}
          onClick={() => setOpen(true)}
          className="flex min-w-0 flex-1 items-center gap-2 py-1 text-ui font-medium text-text"
        >
          <span className="truncate">{project.name}</span>
          {live ? (
            <span
              role="img"
              aria-label={copy.runStatus[live.run.status]}
              className={cn(
                'size-2 shrink-0 rounded-full',
                statusDotClass(live.run.status),
                needsAttention(live.run.status) && 'shadow-glow',
              )}
            />
          ) : null}
        </Link>
        <Link
          to="/workspace/$projectId"
          params={{ projectId: project.id }}
          aria-label={`${copy.workspace.newChatIn} ${project.name}`}
          onClick={() => setOpen(true)}
          className="inline-flex size-7 items-center justify-center rounded-control text-text-2 opacity-0 transition-opacity duration-[120ms] hover:bg-surface-2 hover:text-text focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100"
        >
          <Plus size={14} strokeWidth={1.5} aria-hidden="true" />
        </Link>
      </div>
      {open ? (
        query.isPending ? (
          <p className="px-4 py-2 text-caption text-text-3">{copy.chat.listLoading}</p>
        ) : items.length === 0 ? (
          <p className="px-4 py-2 text-caption text-text-3">{copy.workspace.noChats}</p>
        ) : (
          <nav aria-label={`${copy.chat.listLabel}: ${project.name}`}>
            {items.map((conversation) => (
              <ConversationRow
                key={conversation.id}
                conversation={conversation}
                active={conversation.id === activeConversationId}
                onRename={(title) => void actions.rename(conversation.id, title)}
                onPin={(pinned) => void actions.setPinned(conversation.id, pinned)}
                onArchive={() => void actions.archive(conversation.id)}
                onHandoff={() => void actions.handoff(conversation.id)}
                onDelete={() => void actions.remove(conversation.id)}
              />
            ))}
          </nav>
        )
      ) : null}
    </li>
  );
}

/**
 * Sidebar tab Project: semua project terdaftar, masing-masing dengan percakapannya dan penanda run yang
 * sedang berjalan. Memilih project atau percakapan membuka chat sesuai folder project itu.
 */
export function WorkspaceSidebar() {
  const projects = useProjects();
  const runs = useWorkspaceRuns();
  const online = useOnline();
  const params = useParams({ strict: false });
  const [dialogOpen, setDialogOpen] = useState(false);
  const list = projects.data ?? [];
  const view: ViewState = projects.isPending
    ? 'loading'
    : projects.isError && !projects.data
      ? online
        ? 'error'
        : 'offline'
      : list.length === 0
        ? 'empty'
        : 'content';

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <StateView
          state={view}
          loadingLabel={copy.projects.loading}
          emptyMessage={copy.projects.empty}
          emptyAction={
            <Button variant="secondary" onClick={() => setDialogOpen(true)}>
              <Plus size={14} strokeWidth={1.5} aria-hidden="true" />
              {copy.projects.add}
            </Button>
          }
          errorMessage={projects.isError ? apiErrorMessage(projects.error, online) : ''}
          offlineMessage={copy.states.offline}
          retryLabel={copy.states.retry}
          onRetry={() => void projects.refetch()}
        >
          <ul aria-label={copy.projects.listLabel} className="flex flex-col gap-0.5 p-2">
            {list.map((project) => (
              <ProjectGroup
                key={project.id}
                project={project}
                selected={params.projectId === project.id}
                activeConversationId={params.conversationId}
                live={liveRunOf(runs.data ?? [], project.id)}
              />
            ))}
          </ul>
        </StateView>
      </div>
      <div className="border-t border-border p-2">
        <Link
          to="/projects"
          className="flex h-8 items-center gap-2 rounded-control px-2 text-ui text-text-2 transition-colors duration-[120ms] ease-aios hover:bg-surface-2 hover:text-text"
        >
          <Settings2 size={14} strokeWidth={1.5} aria-hidden="true" />
          {copy.workspace.manage}
        </Link>
      </div>
      <AddProjectDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}
