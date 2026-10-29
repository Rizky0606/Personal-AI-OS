import { Plus } from 'lucide-react';
import { useState } from 'react';
import { apiErrorMessage } from '../api/errors';
import { useOnline } from '../app/hooks';
import { copy } from '../copy';
import { Button } from '../ui/Button';
import { ListItem } from '../ui/ListItem';
import { StateView, type ViewState } from '../ui/StateView';
import { AddProjectDialog } from './AddProjectDialog';
import { useProjectRows } from './useProjectRows';

/** Daftar ringkas project di sidebar: nama dan branch bawaan. */
export function ProjectList() {
  const { rows, projects, worker } = useProjectRows();
  const online = useOnline();
  const [dialogOpen, setDialogOpen] = useState(false);
  const view: ViewState = projects.isPending
    ? 'loading'
    : projects.isError && !projects.data
      ? online
        ? 'error'
        : 'offline'
      : rows.length === 0
        ? 'empty'
        : 'content';
  return (
    <>
      <StateView
        state={view}
        loadingLabel={copy.projects.loading}
        emptyMessage={copy.projects.empty}
        emptyAction={
          <Button
            variant="secondary"
            disabled={worker.local !== 'connected'}
            onClick={() => setDialogOpen(true)}
          >
            <Plus size={14} strokeWidth={1.5} aria-hidden="true" />
            {copy.projects.add}
          </Button>
        }
        errorMessage={projects.isError ? apiErrorMessage(projects.error, online) : ''}
        offlineMessage={copy.states.offline}
        retryLabel={copy.states.retry}
        onRetry={() => void projects.refetch()}
      >
        <ul aria-label={copy.projects.listLabel}>
          {rows.map(({ project, binding }) => (
            <li key={project.id}>
              <ListItem
                title={project.name}
                supporting={binding ? project.defaultBranch : copy.projects.folderMissing}
              />
            </li>
          ))}
        </ul>
      </StateView>
      <AddProjectDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}
