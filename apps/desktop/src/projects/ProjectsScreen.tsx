import { useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { apiErrorMessage } from '../api/errors';
import { useOnline } from '../app/hooks';
import { workerApi } from '../app/services';
import { copy } from '../copy';
import { pickFolder } from '../lib/pickFolder';
import { Button } from '../ui/Button';
import { ErrorBanner } from '../ui/ErrorBanner';
import { StateView, type ViewState } from '../ui/StateView';
import { useToastStore } from '../ui/Toaster';
import { workerErrorMessage } from '../worker/errors';
import { AddProjectDialog } from './AddProjectDialog';
import { StackChips } from './StackChips';
import { useProjectRows } from './useProjectRows';

const headerClass =
  'border-b border-border-strong px-3 py-2 text-left text-meta font-medium text-text-2';
const cellClass = 'border-b border-border px-3 py-2 align-top text-ui';

/** Daftar project terdaftar dan penambahan project baru lewat worker lokal. */
export function ProjectsScreen() {
  const { rows, projects, worker } = useProjectRows();
  const online = useOnline();
  const queryClient = useQueryClient();
  const push = useToastStore((s) => s.push);
  const [dialogOpen, setDialogOpen] = useState(false);
  const workerReady = worker.local === 'connected';

  const view: ViewState = projects.isPending
    ? 'loading'
    : projects.isError && !projects.data
      ? online
        ? 'error'
        : 'offline'
      : rows.length === 0
        ? 'empty'
        : 'content';

  async function bind(projectId: string) {
    const path = await pickFolder(copy.projects.dialog.pickTitle);
    if (!path) return;
    try {
      await workerApi.bind(projectId, path);
      await queryClient.invalidateQueries({ queryKey: ['worker'] });
      push(copy.projects.bound);
    } catch (error) {
      push(workerErrorMessage(error), 'danger');
    }
  }

  const addButton = (
    <Button variant="primary" disabled={!workerReady} onClick={() => setDialogOpen(true)}>
      <Plus size={14} strokeWidth={1.5} aria-hidden="true" />
      {copy.projects.add}
    </Button>
  );

  return (
    <div className="flex flex-col">
      <div className="flex h-12 items-center justify-between border-b border-border px-4">
        <h2 className="text-section font-semibold text-text">{copy.projects.title}</h2>
        {view === 'content' ? addButton : null}
      </div>
      {workerReady ? null : (
        <ErrorBanner tone="warning" message={copy.projects.workerOff} className="m-4 mb-0" />
      )}
      <StateView
        state={view}
        loadingLabel={copy.projects.loading}
        emptyMessage={copy.projects.empty}
        emptyAction={addButton}
        errorMessage={projects.isError ? apiErrorMessage(projects.error, online) : ''}
        offlineMessage={copy.states.offline}
        retryLabel={copy.states.retry}
        onRetry={() => void projects.refetch()}
      >
        <table aria-label={copy.projects.listLabel} className="w-full border-collapse">
          <thead>
            <tr>
              {(['name', 'stack', 'branch', 'folder'] as const).map((column) => (
                <th key={column} scope="col" className={headerClass}>
                  {copy.projects.columns[column]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ project, binding, mine }) => (
              <tr key={project.id}>
                <td className={`${cellClass} font-medium text-text`}>{project.name}</td>
                <td className={cellClass}>
                  <StackChips stack={project.stack} />
                </td>
                <td className={`${cellClass} font-mono text-meta text-text-2`}>
                  {project.defaultBranch}
                </td>
                <td className={cellClass}>
                  {binding ? (
                    <span className="flex flex-col gap-1">
                      <span
                        className="font-mono text-meta break-all text-text"
                        title={binding.path}
                      >
                        {binding.path}
                      </span>
                      {binding.available ? null : (
                        <span className="text-meta text-warning">
                          {copy.projects.folderUnavailable}
                        </span>
                      )}
                    </span>
                  ) : mine ? (
                    <span className="flex items-center gap-2">
                      <span className="text-meta text-text-2">{copy.projects.unbound}</span>
                      <Button
                        variant="secondary"
                        disabled={!workerReady}
                        aria-label={`${copy.projects.bindFolder}: ${project.name}`}
                        onClick={() => void bind(project.id)}
                      >
                        {copy.projects.bindFolder}
                      </Button>
                    </span>
                  ) : (
                    <span className="text-meta text-text-3">{copy.projects.folderMissing}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </StateView>
      <AddProjectDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}
