import { Bot, Cpu, FolderGit2, PanelRight, Plus } from 'lucide-react';
import { useModels, useRoles } from '../api/queries';
import { useConnection, useOnline } from '../app/hooks';
import { copy } from '../copy';
import { cn } from '../lib/cn';
import type { ConnectionState } from '../realtime/client';
import { useUiStore } from '../state/uiStore';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { useProjects } from '../worker/hooks';
import { connectionView } from './connectionView';
import { ProgressChip } from './ProgressChip';

export type ConnectionTone = 'connected' | 'pending' | 'lost';

/** Tiga keadaan koneksi untuk topbar: terhubung, menyambung ulang, terputus (termasuk luring). */
export function connectionTone(connection: ConnectionState, online: boolean): ConnectionTone {
  if (!online) return 'lost';
  if (connection.kind === 'connected') return 'connected';
  if (connection.kind === 'idle') return 'lost';
  return 'pending';
}

const dot: Record<ConnectionTone, string> = {
  connected: 'bg-done',
  pending: 'bg-tool animate-aios-breathe',
  lost: 'bg-error',
};

/** Indikator koneksi: titik berwarna status dan teks (warna bukan satu-satunya penanda). */
export function ConnectionBadge() {
  const connection = useConnection();
  const online = useOnline();
  const view = connectionView(connection, online);
  return (
    <span
      role="status"
      data-connection={connectionTone(connection, online)}
      className="inline-flex h-7 items-center gap-2 rounded-badge bg-surface-2 px-2 text-meta text-text-2"
    >
      <span
        aria-hidden="true"
        className={cn('size-2 rounded-full', dot[connectionTone(connection, online)])}
      />
      {view.label}
    </span>
  );
}

function Chip({
  icon,
  children,
  hint,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  /** Penjelasan singkat (tooltip) bila teks chip saja kurang jelas. */
  hint?: string | undefined;
}) {
  return (
    <span
      data-chip
      title={hint}
      className="inline-flex h-7 min-w-0 max-w-56 items-center gap-2 rounded-badge bg-surface-2 px-2 text-meta text-text-2"
    >
      {icon}
      <span className="truncate">{children}</span>
    </span>
  );
}

export interface TopbarProps {
  title: string;
  /** Layar chat: tampilkan project aktif, branch, dan model. */
  chat: boolean;
  /** Aksi utama bagian ini (Chat baru, Riset baru). */
  action?: { label: string; onSelect: () => void } | undefined;
  rightPanelOpen: boolean;
  onToggleRightPanel: () => void;
}

/**
 * Topbar 48 px di dalam pulau utama: judul layar (h1), di layar chat project aktif dengan branch (branch kerja
 * agent selama run berjalan) dan model, lalu di kanan indikator koneksi, aksi konteks bagian ini, dan tombol panel
 * kanan. Judul, project, dan model satu grup "Lokasi saat ini".
 */
export function Topbar({ title, chat, action, rightPanelOpen, onToggleRightPanel }: TopbarProps) {
  const activeProjectId = useUiStore((s) => s.activeProjectId);
  const runBranch = useUiStore((s) => s.activeRunBranch);
  const modelId = useUiStore((s) => s.model);
  const project = useProjects().data?.find((p) => p.id === activeProjectId);
  const models = useModels().data;
  // Agent terakhir yang menjawab; baru ada setelah sebuah run, jadi tidak ada chip kosong sebelum itu.
  const activeRole = useUiStore((s) => s.activeRole);
  const roleName = useRoles().data?.find((r) => r.id === activeRole)?.name ?? activeRole;
  const modelLabel = modelId
    ? (models?.find((m) => m.id === modelId)?.label ?? modelId)
    : copy.shell.modelAuto;
  // Selama run coding berjalan: branch kerja agent; selain itu branch bawaan project.
  const branch = project ? (runBranch ?? project.defaultBranch) : null;

  return (
    <header className="flex h-(--aios-topbar-height) shrink-0 items-center justify-between gap-3 border-b border-border px-4">
      <div
        role="group"
        aria-label={copy.shell.location}
        className="flex min-w-0 items-center gap-3"
      >
        <h1 className="min-w-0 shrink truncate text-section font-semibold text-text">{title}</h1>
        {chat ? (
          <div className="flex min-w-0 items-center gap-2">
            <Chip
              icon={
                <FolderGit2 size={14} strokeWidth={1.5} aria-hidden="true" className="shrink-0" />
              }
            >
              {project?.name ?? copy.status.project}
              {branch ? (
                <span className="ml-2 font-mono text-caption text-text-3">{branch}</span>
              ) : null}
            </Chip>
            {runBranch !== null ? (
              <span className="inline-flex h-7 shrink-0 items-center gap-2 rounded-badge bg-accent-soft px-2 text-meta text-text">
                <span
                  aria-hidden="true"
                  className="size-2 animate-aios-breathe rounded-full bg-accent"
                />
                {copy.shell.runActive}
              </span>
            ) : null}
            {roleName ? (
              <Chip
                icon={<Bot size={14} strokeWidth={1.5} aria-hidden="true" className="shrink-0" />}
                hint={copy.shell.roleHint}
              >
                {roleName}
              </Chip>
            ) : null}
            <Chip
              icon={<Cpu size={14} strokeWidth={1.5} aria-hidden="true" className="shrink-0" />}
              hint={modelId ? undefined : copy.settings.modelAutoHint}
            >
              {modelLabel}
            </Chip>
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {chat ? <ProgressChip /> : null}
        <ConnectionBadge />
        {action ? (
          <Button variant="secondary" onClick={action.onSelect}>
            <Plus size={14} strokeWidth={1.5} aria-hidden="true" />
            {action.label}
          </Button>
        ) : null}
        <IconButton
          label={copy.shell.toggleRightPanel}
          active={rightPanelOpen}
          aria-pressed={rightPanelOpen}
          onClick={onToggleRightPanel}
        >
          <PanelRight size={16} strokeWidth={1.5} aria-hidden="true" />
        </IconButton>
      </div>
    </header>
  );
}
