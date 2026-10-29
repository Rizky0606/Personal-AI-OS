import { Link, useRouterState } from '@tanstack/react-router';
import { PanelLeftClose, Search } from 'lucide-react';
import type { ReactNode } from 'react';
import { copy } from '../copy';
import { cn } from '../lib/cn';
import { useUiStore } from '../state/uiStore';
import { IconButton } from '../ui/IconButton';
import { Tooltip } from '../ui/Tooltip';
import { isActive, navItems, settingsItem, type NavItem } from './navItems';
import { SidebarStatus } from './SidebarStatus';

export interface SidebarProps {
  /** Judul bagian saat ini (Chat, Project, ...), di atas daftar konteks. */
  title: string;
  /** Aksi utama bagian ini (mis. Chat baru), di sebelah judul daftar. */
  action?: ReactNode;
  /** Daftar konteks bagian aktif: percakapan, riset, jadwal. */
  children: ReactNode;
}

function NavLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const active = isActive(item.to, pathname);
  const link = (
    <Link
      to={item.to}
      aria-label={item.label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex h-9 items-center rounded-control text-ui text-text-2 transition-colors duration-[120ms] ease-aios hover:bg-surface-2 hover:text-text',
        collapsed ? 'w-10 justify-center' : 'w-full gap-3 px-2.5',
        // Penanda aktif: garis aksen 2px di tepi sidebar, tumbuh dari tengah saat berpindah bagian.
        'before:absolute before:top-2 before:bottom-2 before:-left-2 before:w-0.5 before:rounded-full before:bg-accent before:shadow-glow before:transition-transform before:duration-[180ms] before:ease-spring',
        active ? 'bg-accent-soft font-medium text-text before:scale-y-100' : 'before:scale-y-0',
      )}
    >
      {item.icon}
      {collapsed ? null : <span className="min-w-0 truncate">{item.label}</span>}
    </Link>
  );
  return collapsed ? <Tooltip label={item.label}>{link}</Tooltip> : link;
}

/**
 * Sidebar tunggal 232px yang ciut menjadi 64px berisi ikon (Ctrl+B): pencarian Ctrl+K, enam bagian utama,
 * daftar konteks bagian aktif, dan kaki berisi status worker, kuota, koneksi, serta Pengaturan.
 */
export function Sidebar({ title, action, children }: SidebarProps) {
  const open = useUiStore((s) => s.sidebarOpen);
  const toggle = useUiStore((s) => s.toggleSidebar);
  const setPaletteOpen = useUiStore((s) => s.setPaletteOpen);
  const collapsed = !open;
  return (
    <aside
      aria-label={copy.shell.sidebar}
      className={cn(
        'flex shrink-0 flex-col overflow-hidden border-r border-border bg-surface transition-[width] duration-[180ms] ease-aios',
        collapsed ? 'w-(--aios-rail-width)' : 'w-(--aios-sidebar-width)',
      )}
    >
      <div
        className={cn(
          'flex h-(--aios-header-height) shrink-0 items-center gap-1 px-2',
          collapsed && 'justify-center',
        )}
      >
        {collapsed ? (
          <IconButton label={copy.shell.search} onClick={() => setPaletteOpen(true)}>
            <Search size={16} strokeWidth={1.5} aria-hidden="true" />
          </IconButton>
        ) : (
          <>
            <button
              type="button"
              aria-keyshortcuts="Control+K"
              onClick={() => setPaletteOpen(true)}
              className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-control border border-border bg-bg px-2.5 text-meta text-text-2 transition-colors duration-[120ms] ease-aios hover:border-border-strong hover:text-text"
            >
              <Search size={14} strokeWidth={1.5} aria-hidden="true" className="shrink-0" />
              <span className="min-w-0 flex-1 truncate text-left">{copy.shell.search}</span>
              <kbd className="shrink-0 font-mono text-caption text-text-3">
                {copy.shell.searchHint}
              </kbd>
            </button>
            <IconButton label={copy.shell.collapseSidebar} onClick={toggle}>
              <PanelLeftClose size={16} strokeWidth={1.5} aria-hidden="true" />
            </IconButton>
          </>
        )}
      </div>

      <nav
        aria-label={copy.shell.navigation}
        className={cn('flex shrink-0 flex-col gap-0.5 px-2 pb-2', collapsed && 'items-center')}
      >
        {navItems.map((item) => (
          <NavLink key={item.to} item={item} collapsed={collapsed} />
        ))}
      </nav>

      {collapsed ? (
        <div className="flex-1" />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col border-t border-border">
          <div className="flex h-9 shrink-0 items-center justify-between pr-2 pl-4">
            <h2 className="truncate text-caption font-semibold tracking-wide text-text-2 uppercase">
              {title}
            </h2>
            {action}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </div>
      )}

      <div
        className={cn(
          'flex shrink-0 flex-col gap-2 border-t border-border p-2',
          collapsed && 'items-center',
        )}
      >
        <SidebarStatus collapsed={collapsed} />
        <NavLink item={settingsItem} collapsed={collapsed} />
      </div>
    </aside>
  );
}
