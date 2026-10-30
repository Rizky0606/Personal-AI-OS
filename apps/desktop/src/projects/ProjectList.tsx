import { Plus } from 'lucide-react';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { apiErrorMessage } from '../api/errors';
import { useOnline } from '../app/hooks';
import { copy } from '../copy';
import { Button } from '../ui/Button';
import { ListItem } from '../ui/ListItem';
import { PlateGroup } from '../ui/PlateGroup';
import { useUiStore } from '../state/uiStore';
import { StateView, type ViewState } from '../ui/StateView';
import { AddProjectDialog } from './AddProjectDialog';
import { useProjectRows } from './useProjectRows';

/** Daftar ringkas project di sidebar: nama dan branch bawaan; project aktif ditandai pelat, klik membuka chat project. */
export function ProjectList() {
  const { rows, projects, worker } = useProjectRows();
  const online = useOnline();
  const navigate = useNavigate();
  const activeId = useUiStore((s) => s.activeProjectId);
  const setActive = useUiStore((s) => s.setActiveProject);
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
        <PlateGroup activeKey={activeId}>
          <ul aria-label={copy.projects.listLabel}>
            {rows.map(({ project, binding }, i) => (
              <li key={project.id} data-plate-key={project.id} className="relative">
                <ListItem
                  index={i}
                  title={project.name}
                  supporting={binding ? project.defaultBranch : copy.projects.folderMissing}
                  onClick={() => {
                    setActive(project.id);
                    void navigate({
                      to: '/workspace/$projectId',
                      params: { projectId: project.id },
                    });
                  }}
                />
              </li>
            ))}
          </ul>
        </PlateGroup>
      </StateView>
      <AddProjectDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}
