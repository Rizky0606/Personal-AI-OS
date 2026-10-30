import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { apiErrorMessage } from '../api/errors';
import { useOnline } from '../app/hooks';
import { api, workerApi } from '../app/services';
import { copy } from '../copy';
import { pickFolder } from '../lib/pickFolder';
import { Page, PageHeader } from '../screens/PageLayout';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { PageContainer } from '../ui/PageContainer';
import { StateView, type ViewState } from '../ui/StateView';
import { useToastStore } from '../ui/Toaster';
import { workerErrorMessage } from '../worker/errors';
import type { Project } from '@aios/contracts';
import { AddProjectDialog } from './AddProjectDialog';
import { BranchDialog } from './BranchDialog';
import { ProjectRow } from './ProjectRow';
import { ProjectRulesDialog } from './ProjectRulesDialog';
import { ProjectSetupDialog } from './ProjectSetupDialog';
import { useProjectRows } from './useProjectRows';
import { useLatestRuns } from './useLatestRuns';
import { useUiStore } from '../state/uiStore';

/** Daftar project terdaftar dan penambahan project baru lewat worker lokal. */
export function ProjectsScreen() {
  const { rows, projects, worker } = useProjectRows();
  const latest = useLatestRuns();
  const navigate = useNavigate();
  const setActive = useUiStore((s) => s.setActiveProject);
  const openChat = (projectId: string) => {
    setActive(projectId);
    void navigate({ to: '/workspace/$projectId', params: { projectId } });
  };
  const online = useOnline();
  const queryClient = useQueryClient();
  const push = useToastStore((s) => s.push);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [rulesOf, setRulesOf] = useState<Project | null>(null);
  const [setupOf, setSetupOf] = useState<Project | null>(null);
  const [branchOf, setBranchOf] = useState<{ project: Project; path: string | null } | null>(null);
  const [unbindOf, setUnbindOf] = useState<{ projectId: string; path: string } | null>(null);
  const [removeOf, setRemoveOf] = useState<{ project: Project; bound: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  async function unbind(projectId: string) {
    setBusy(true);
    try {
      await workerApi.unbind(projectId);
      await queryClient.invalidateQueries({ queryKey: ['worker'] });
      push(copy.projects.unbind.done);
    } catch (error) {
      push(workerErrorMessage(error), 'danger');
    } finally {
      setBusy(false);
      setUnbindOf(null);
    }
  }

  async function remove(project: Project, bound: boolean) {
    setBusy(true);
    try {
      await api.deleteProject(project.id);
      // Ikatan folder lokal ikut dilepas supaya worker tidak menyimpan project yang sudah tidak ada.
      if (bound) await workerApi.unbind(project.id).catch(() => undefined);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['projects'] }),
        queryClient.invalidateQueries({ queryKey: ['worker'] }),
        queryClient.invalidateQueries({ queryKey: ['conversations'] }),
      ]);
      push(copy.projects.remove.done);
    } catch (error) {
      push(apiErrorMessage(error, online), 'danger');
    } finally {
      setBusy(false);
      setRemoveOf(null);
    }
  }
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
  const emptyAddButton = (
    <Button variant="primary" disabled={!workerReady} onClick={() => setDialogOpen(true)}>
      <Plus size={14} strokeWidth={1.5} aria-hidden="true" />
      {copy.projects.add}
    </Button>
  );

  return (
    <Page>
      <PageHeader title={copy.projects.title} actions={workerReady ? addButton : undefined} />
      <PageContainer>
        {!workerReady ? (
          <p role="alert" className="mb-3 text-meta text-warning">
            {copy.projects.workerOff}
          </p>
        ) : null}
        <StateView
          state={view}
          loadingLabel={copy.projects.loading}
          emptyMessage={copy.projects.empty}
          emptyAction={emptyAddButton}
          errorMessage={projects.isError ? apiErrorMessage(projects.error, online) : ''}
          offlineMessage={copy.states.offline}
          retryLabel={copy.states.retry}
          onRetry={() => void projects.refetch()}
        >
        <div role="list" aria-label={copy.projects.listLabel}>
          <table aria-label={copy.projects.listLabel} className="w-full border-collapse rounded-panel border border-border bg-surface">
            <tbody>
              {rows.map(({ project, binding, mine }, index) => (
                <ProjectRow
                  key={project.id} project={project} binding={binding} mine={mine} workerReady={workerReady} index={index}
                  onBind={() => void bind(project.id)}
                  onChangeBranch={() => setBranchOf({ project, path: binding?.available ? binding.path : null })}
                  onEditSetup={() => setSetupOf(project)} onEditRules={() => setRulesOf(project)}
                  onUnbind={() => binding && setUnbindOf({ projectId: project.id, path: binding.path })}
                  onRemove={() => setRemoveOf({ project, bound: !!binding })} onOpenChat={() => openChat(project.id)} latest={latest[project.id]}
                />
              ))}
            </tbody>
          </table>
        </div>
      </StateView>
      <AddProjectDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      <ProjectRulesDialog project={rulesOf} onClose={() => setRulesOf(null)} />
      <ProjectSetupDialog project={setupOf} onClose={() => setSetupOf(null)} />
      <BranchDialog
        project={branchOf?.project ?? null}
        path={branchOf?.path ?? null}
        onClose={() => setBranchOf(null)}
      />
      <ConfirmDialog
        open={unbindOf !== null}
        onOpenChange={(open) => !open && setUnbindOf(null)}
        title={copy.projects.unbind.title}
        body={unbindOf ? copy.projects.unbind.body(unbindOf.path) : ''}
        confirmLabel={copy.projects.unbind.action}
        cancelLabel={copy.chat.cancel}
        busy={busy}
        onConfirm={() => unbindOf && void unbind(unbindOf.projectId)}
      />
      <ConfirmDialog
        open={removeOf !== null}
        onOpenChange={(open) => !open && setRemoveOf(null)}
        title={copy.projects.remove.title}
        body={removeOf ? copy.projects.remove.body(removeOf.project.name) : ''}
        confirmLabel={copy.projects.remove.action}
        cancelLabel={copy.chat.cancel}
        destructive
        busy={busy}
        onConfirm={() => removeOf && void remove(removeOf.project, removeOf.bound)}
      />
      </PageContainer>
    </Page>
  );
}
