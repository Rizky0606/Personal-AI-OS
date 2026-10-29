import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { MAX_FLEET_TASKS } from '@aios/contracts';
import { apiErrorMessage } from '../api/errors';
import { useOnline } from '../app/hooks';
import { api } from '../app/services';
import { ApiProblem } from '../auth/authSession';
import { copy } from '../copy';
import { DialogFrame } from '../screens/DialogFrame';
import { useUiStore } from '../state/uiStore';
import { Button } from '../ui/Button';
import { ErrorBanner } from '../ui/ErrorBanner';
import { IconButton } from '../ui/IconButton';
import { RadioMenu } from '../ui/RadioMenu';
import { Switch } from '../ui/Switch';
import { TextArea } from '../ui/TextArea';
import { useToastStore } from '../ui/Toaster';
import { useProjects } from '../worker/hooks';

export interface FleetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Armada agent: beberapa tugas berbeda dimulai sekaligus di satu project. Tiap tugas menjadi percakapan dan run
 * sendiri di worktree sendiri; kemajuannya dipantau di daftar run tab Project.
 */
export function FleetDialog({ open, onOpenChange }: FleetDialogProps) {
  const projects = useProjects();
  const activeProjectId = useUiStore((s) => s.activeProjectId);
  const model = useUiStore((s) => s.model);
  const queryClient = useQueryClient();
  const online = useOnline();
  const push = useToastStore((s) => s.push);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<string[]>(['']);
  const [planOnly, setPlanOnly] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = projects.data ?? [];

  // Dibuka: mulai dari kosong, project yang sedang dipilih (atau yang pertama).
  useEffect(() => {
    if (!open) return;
    setTasks(['']);
    setPlanOnly(false);
    setError(null);
    setProjectId(null);
  }, [open]);

  const chosen = list.find((p) => p.id === (projectId ?? activeProjectId)) ?? list[0];
  const filled = tasks.map((t) => t.trim()).filter(Boolean);
  const canLaunch = chosen !== undefined && filled.length > 0 && !working && online;

  async function launch() {
    if (!chosen) return;
    if (filled.length === 0) return setError(copy.fleet.needTask);
    setWorking(true);
    setError(null);
    try {
      const result = await api.launchFleet({
        projectId: chosen.id,
        tasks: filled.map((prompt) => ({ prompt })),
        planOnly,
        model: model ?? undefined,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['workspaceRuns'] }),
        queryClient.invalidateQueries({ queryKey: ['conversations'] }),
      ]);
      push(copy.fleet.launched(result.items.length, result.failed));
      onOpenChange(false);
    } catch (e) {
      // Batas agent punya penjelasan sendiri dari server (berapa yang sedang berjalan); 409 umum terlalu samar.
      setError(
        e instanceof ApiProblem && e.code === 'fleet_busy' ? e.message : apiErrorMessage(e, online),
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <DialogFrame
      open={open}
      onOpenChange={onOpenChange}
      title={copy.fleet.title}
      description={copy.fleet.intro}
      size="md"
      footer={
        <>
          <Button variant="ghost" disabled={working} onClick={() => onOpenChange(false)}>
            {copy.fleet.cancel}
          </Button>
          <Button variant="primary" disabled={!canLaunch} onClick={() => void launch()}>
            {working ? copy.fleet.launching : copy.fleet.launch(Math.max(filled.length, 1))}
          </Button>
        </>
      }
    >
      {error ? <ErrorBanner message={error} /> : null}

      {list.length === 0 ? (
        <p className="text-ui text-text-3">{copy.fleet.noProject}</p>
      ) : (
        <div className="flex flex-col gap-1">
          <span className="text-meta text-text-2">{copy.fleet.project}</span>
          <RadioMenu
            label={copy.fleet.projectPick}
            value={chosen?.id ?? ''}
            onValueChange={setProjectId}
            options={list.map((p) => ({ value: p.id, label: p.name }))}
            trigger={
              <button
                type="button"
                aria-label={`${copy.fleet.project}: ${chosen?.name ?? ''}`}
                className="flex h-9 w-full items-center justify-between gap-2 rounded-control border border-border bg-surface px-3 text-ui text-text transition-colors duration-[120ms] ease-aios hover:bg-surface-2"
              >
                <span className="truncate">{chosen?.name ?? copy.fleet.projectPick}</span>
                <ChevronDown
                  size={14}
                  strokeWidth={1.5}
                  aria-hidden="true"
                  className="shrink-0 text-text-2"
                />
              </button>
            }
          />
        </div>
      )}

      <div className="flex flex-col gap-3">
        {tasks.map((text, index) => (
          <div key={index} className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <TextArea
                label={copy.fleet.task(index + 1)}
                rows={2}
                value={text}
                disabled={working}
                placeholder={copy.fleet.taskPlaceholder}
                onChange={(event) =>
                  setTasks((current) =>
                    current.map((t, i) => (i === index ? event.target.value : t)),
                  )
                }
              />
            </div>
            {tasks.length > 1 ? (
              <span className="pt-6">
                <IconButton
                  label={copy.fleet.removeTask(index + 1)}
                  disabled={working}
                  onClick={() => setTasks((current) => current.filter((_, i) => i !== index))}
                >
                  <X size={14} strokeWidth={1.5} aria-hidden="true" />
                </IconButton>
              </span>
            ) : null}
          </div>
        ))}
        {tasks.length < MAX_FLEET_TASKS ? (
          <Button
            variant="ghost"
            disabled={working}
            onClick={() => setTasks((current) => [...current, ''])}
            className="self-start"
          >
            <Plus size={14} strokeWidth={1.5} aria-hidden="true" />
            {copy.fleet.addTask}
          </Button>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <Switch
          checked={planOnly}
          onChange={setPlanOnly}
          label={copy.fleet.planOnly}
          disabled={working}
        />
        <span className="text-ui text-text-2">{copy.fleet.planOnly}</span>
      </div>
    </DialogFrame>
  );
}
