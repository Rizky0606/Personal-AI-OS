import { PanelLeftOpen, PanelRight } from 'lucide-react';
import { useModels, useRoles } from '../api/queries';
import { copy } from '../copy';
import { cn } from '../lib/cn';
import { useUiStore } from '../state/uiStore';
import { IconButton } from '../ui/IconButton';
import { useProjects } from '../worker/hooks';

/**
 * Header 48px di area utama: tombol buka sidebar (saat ciut), breadcrumb bagian, project, dan branch,
 * pil status run (role, model), dan tombol panel kanan.
 */
export function Header({ title }: { title: string }) {
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const rightPanelOpen = useUiStore((s) => s.rightPanelOpen);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const toggleRightPanel = useUiStore((s) => s.toggleRightPanel);
  const activeProjectId = useUiStore((s) => s.activeProjectId);
  const runBranch = useUiStore((s) => s.activeRunBranch);
  const activeRole = useUiStore((s) => s.activeRole);
  const modelId = useUiStore((s) => s.model);
  const project = useProjects().data?.find((p) => p.id === activeProjectId);
  const roles = useRoles().data;
  const models = useModels().data;

  const roleLabel = activeRole
    ? (roles?.find((r) => r.id === activeRole)?.name ?? activeRole)
    : copy.status.role;
  const modelLabel = modelId
    ? (models?.find((m) => m.id === modelId)?.label ?? modelId)
    : copy.status.model;
  // Selama run coding berjalan: branch kerja agent; selain itu branch bawaan project.
  const branch = project ? (runBranch ?? project.defaultBranch) : null;
  const running = runBranch !== null;

  return (
    <header className="flex h-(--aios-header-height) shrink-0 items-center justify-between gap-3 border-b border-border px-3">
      <div
        role="group"
        aria-label={copy.shell.location}
        className="flex min-w-0 items-center gap-2"
      >
        {sidebarOpen ? null : (
          <IconButton label={copy.shell.expandSidebar} onClick={toggleSidebar}>
            <PanelLeftOpen size={16} strokeWidth={1.5} aria-hidden="true" />
          </IconButton>
        )}
        <h1 className="shrink-0 text-ui font-semibold text-text">{title}</h1>
        {project ? (
          <>
            <span aria-hidden="true" className="text-text-3">
              /
            </span>
            <span className="min-w-0 truncate text-ui text-text-2">{project.name}</span>
            <span className="min-w-0 truncate font-mono text-caption text-text-3">{branch}</span>
          </>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <div className="flex max-w-96 items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-meta text-text-2">
          <span
            aria-hidden="true"
            className={cn(
              'size-2 shrink-0 rounded-full',
              running ? 'animate-aios-breathe bg-accent' : 'bg-text-3',
            )}
          />
          {running ? <span className="truncate">{copy.shell.runActive}</span> : null}
          <span className="truncate" data-status-role>{roleLabel}</span>
          <span aria-hidden="true" className="text-text-3">·</span>
          <span className="truncate font-mono text-caption" data-status-model>{modelLabel}</span>
        </div>
        <IconButton
          label={copy.shell.toggleRightPanel}
          active={rightPanelOpen}
          aria-pressed={rightPanelOpen}
          onClick={toggleRightPanel}
        >
          <PanelRight size={16} strokeWidth={1.5} aria-hidden="true" />
        </IconButton>
      </div>
    </header>
  );
}
