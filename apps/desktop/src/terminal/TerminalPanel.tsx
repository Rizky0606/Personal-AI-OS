import { copy } from '../copy';
import { useUiStore } from '../state/uiStore';
import { EmptyState } from '../ui/EmptyState';
import { PickProjectButton, WorkerStatusButton } from '../ui/EmptyActions';
import { useWorker } from '../worker/hooks';
import { TerminalView } from './TerminalView';

/** Isi tab Terminal: shell di folder project, atau di worktree run yang sedang ditinjau. */
export function TerminalPanel() {
  const projectId = useUiStore((s) => s.activeProjectId);
  const runId = useUiStore((s) => s.reviewRunId);
  const connected = useWorker().local === 'connected';
  if (!projectId) {
    return <EmptyState message={copy.terminal.noProject} action={<PickProjectButton />} />;
  }
  if (!connected) {
    return <EmptyState message={copy.terminal.workerOffline} action={<WorkerStatusButton />} />;
  }
  // Dikunci per target supaya satu terminal tidak berpindah isi saat project atau run berganti.
  return (
    <TerminalView
      key={`${projectId}:${runId ?? ''}`}
      projectId={projectId}
      runId={runId ?? undefined}
    />
  );
}
