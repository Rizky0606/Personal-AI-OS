import { Link, useRouterState } from '@tanstack/react-router';
import { BrainCircuit, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';
import { copy } from '../copy';
import { cn } from '../lib/cn';
import { useUiStore } from '../state/uiStore';
import { IconButton } from '../ui/IconButton';
import { PlateGroup } from '../ui/PlateGroup';
import { Tooltip } from '../ui/Tooltip';
import { NAV_ITEMS, isNavActive, type NavItem } from './navItems';
import { ISLAND } from './island';

export interface SidebarProps {
  /** Judul bagian saat ini (Chat, Project, ...), di atas daftar konteks. */
  title: string;
  /** Daftar konteks bagian aktif (percakapan, riset, jadwal); tersembunyi saat sidebar ringkas. */
  children: ReactNode;
}

function NavLink({ item, active, compact }: { item: NavItem; active: boolean; compact: boolean }) {
  const link = (
    <Link
      to={item.to}
      aria-label={item.label}
      aria-current={active ? 'page' : undefined}
      data-plate-key={item.to}
      className={cn(
        'relative z-10 flex h-9 items-center gap-3 rounded-control px-3 text-ui whitespace-nowrap transition-colors duration-[120ms] ease-aios',
        active ? 'text-text' : 'text-text-2 hover:text-text',
      )}
    >
      <span className="shrink-0">{item.icon}</span>
      {/* Ringkas: label tetap ada untuk pembaca layar dan tooltip, hanya disembunyikan dari tampilan. */}
      <span className={cn('truncate', compact && 'sr-only')}>{item.label}</span>
    </Link>
  );
  return compact ? <Tooltip label={item.label}>{link}</Tooltip> : link;
}

/** Panah atas/bawah, Home, End memindahkan fokus antar item navigasi (Tab tetap berfungsi). */
function onNavKeyDown(event: KeyboardEvent<HTMLElement>) {
  const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
  if (!keys.includes(event.key)) return;
  const links = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('a[data-plate-key]'));
  const index = links.indexOf(document.activeElement as HTMLElement);
  if (index < 0 || links.length === 0) return;
  event.preventDefault();
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? links.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length;
  links[next]?.focus();
}

/**
 * Sidebar sebagai pulau tersendiri: merek, navigasi utama (ikon + label, pelat penanda meluncur), dan daftar
 * konteks bagian aktif. Ringkas (Ctrl+B): 64 px, hanya ikon dengan tooltip; lebar bertransisi 240 ms.
 */
export function Sidebar({ title, children }: SidebarProps) {
  const open = useUiStore((s) => s.sidebarOpen);
  const toggle = useUiStore((s) => s.toggleSidebar);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const compact = !open;
  const activeItem = NAV_ITEMS.find((item) => isNavActive(item.to, pathname));

  return (
    <aside
      aria-label={copy.shell.sidebar}
      data-compact={compact}
      className={cn(
        ISLAND,
        'flex shrink-0 flex-col overflow-hidden transition-[width] duration-[240ms] ease-aios',
        compact ? 'w-(--aios-sidebar-compact-width)' : 'w-(--aios-sidebar-width)',
      )}
    >
      <div className="flex h-(--aios-topbar-height) shrink-0 items-center gap-3 px-3">
        <span
          role="img"
          aria-label={copy.shell.brand}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-control bg-surface-2 text-accent"
        >
          <BrainCircuit size={18} strokeWidth={1.5} aria-hidden="true" />
        </span>
        {compact ? null : (
          <span className="truncate text-ui font-semibold text-text">{copy.shell.brand}</span>
        )}
      </div>

      <nav aria-label={copy.shell.rail} className="shrink-0 px-2" onKeyDown={onNavKeyDown}>
        <PlateGroup activeKey={activeItem?.to ?? null} className="flex flex-col gap-0.5">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              item={item}
              active={item.to === activeItem?.to}
              compact={compact}
            />
          ))}
        </PlateGroup>
      </nav>

      {compact ? (
        <div className="min-h-0 flex-1" />
      ) : (
        <section
          aria-label={title}
          className="mt-2 flex min-h-0 flex-1 flex-col border-t border-border"
        >
          <h2 className="px-4 pt-3 pb-1 text-caption font-medium text-text-3">{title}</h2>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </section>
      )}

      <div className={cn('shrink-0 border-t border-border p-2', compact ? '' : 'flex justify-end')}>
        <IconButton
          label={compact ? copy.shell.expandSidebar : copy.shell.collapseSidebar}
          onClick={toggle}
          className={compact ? 'mx-auto flex' : undefined}
        >
          {compact ? (
            <PanelLeftOpen size={16} strokeWidth={1.5} aria-hidden="true" />
          ) : (
            <PanelLeftClose size={16} strokeWidth={1.5} aria-hidden="true" />
          )}
        </IconButton>
      </div>
    </aside>
  );
}
