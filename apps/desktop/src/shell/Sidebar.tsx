import { PanelLeftClose } from 'lucide-react';
import { copy } from '../copy';
import { useUiStore } from '../state/uiStore';
import { EmptyState } from '../ui/EmptyState';
import { IconButton } from '../ui/IconButton';

export interface SidebarProps {
  /** Judul bagian saat ini (Chat, Project, ...). */
  title: string;
  emptyMessage: string;
}

/** Sidebar 260px yang bisa diciutkan (Ctrl+B). Isi daftar (percakapan atau project) datang di fase berikutnya. */
export function Sidebar({ title, emptyMessage }: SidebarProps) {
  const toggle = useUiStore((s) => s.toggleSidebar);
  return (
    <aside
      aria-label={copy.shell.sidebar}
      className="flex w-(--aios-sidebar-width) shrink-0 flex-col border-r border-border bg-surface"
    >
      <div className="flex h-10 items-center justify-between border-b border-border pr-2 pl-3">
        <h2 className="text-ui font-semibold text-text">{title}</h2>
        <IconButton label={copy.shell.collapseSidebar} onClick={toggle}>
          <PanelLeftClose size={16} strokeWidth={1.5} aria-hidden="true" />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <EmptyState message={emptyMessage} />
      </div>
    </aside>
  );
}
