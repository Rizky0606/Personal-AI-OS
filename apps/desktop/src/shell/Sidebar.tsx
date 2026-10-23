import { PanelLeftClose } from 'lucide-react';
import type { ReactNode } from 'react';
import { copy } from '../copy';
import { useUiStore } from '../state/uiStore';
import { IconButton } from '../ui/IconButton';

export interface SidebarProps {
  /** Judul bagian saat ini (Chat, Project, ...). */
  title: string;
  /** Aksi utama bagian ini (mis. Chat baru), di sebelah tombol ciutkan. */
  action?: ReactNode;
  children: ReactNode;
}

/** Sidebar 260px yang bisa diciutkan (Ctrl+B). Isinya daftar milik bagian aktif: percakapan, riset, jadwal. */
export function Sidebar({ title, action, children }: SidebarProps) {
  const toggle = useUiStore((s) => s.toggleSidebar);
  return (
    <aside
      aria-label={copy.shell.sidebar}
      className="flex w-(--aios-sidebar-width) shrink-0 flex-col border-r border-border bg-surface"
    >
      <div className="flex h-10 items-center justify-between border-b border-border pr-2 pl-3">
        <h2 className="text-ui font-semibold text-text">{title}</h2>
        <div className="flex items-center gap-1">
          {action}
          <IconButton label={copy.shell.collapseSidebar} onClick={toggle}>
            <PanelLeftClose size={16} strokeWidth={1.5} aria-hidden="true" />
          </IconButton>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </aside>
  );
}
