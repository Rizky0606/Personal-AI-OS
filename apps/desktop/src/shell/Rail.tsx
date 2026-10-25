import { Link, useRouterState } from '@tanstack/react-router';
import {
  BrainCircuit,
  CalendarClock,
  Folder,
  Kanban,
  MessageSquare,
  Search,
  Settings,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { copy } from '../copy';
import { cn } from '../lib/cn';
import { Tooltip } from '../ui/Tooltip';

interface RailItem {
  to: '/' | '/projects' | '/kanban' | '/schedules' | '/research' | '/settings';
  label: string;
  icon: ReactNode;
}

const ICON = { size: 18, strokeWidth: 1.5, 'aria-hidden': true } as const;

const items: RailItem[] = [
  { to: '/', label: copy.nav.chat, icon: <MessageSquare {...ICON} /> },
  { to: '/projects', label: copy.nav.projects, icon: <Folder {...ICON} /> },
  { to: '/kanban', label: copy.nav.kanban, icon: <Kanban {...ICON} /> },
  { to: '/schedules', label: copy.nav.schedules, icon: <CalendarClock {...ICON} /> },
  { to: '/research', label: copy.nav.research, icon: <Search {...ICON} /> },
];

const settings: RailItem = {
  to: '/settings',
  label: copy.nav.settings,
  icon: <Settings {...ICON} />,
};

/** Chat aktif di "/" dan di "/chat/<id>"; bagian lain aktif untuk rute turunannya. */
function isActive(to: string, pathname: string): boolean {
  if (to === '/') return pathname === '/' || pathname.startsWith('/chat');
  return pathname === to || pathname.startsWith(`${to}/`);
}

function RailLink({ item }: { item: RailItem }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const active = isActive(item.to, pathname);
  return (
    <Tooltip label={item.label}>
      <Link
        to={item.to}
        aria-label={item.label}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'relative inline-flex size-10 items-center justify-center rounded-control text-text-2 transition-colors duration-[120ms] ease-aios hover:bg-surface-2 hover:text-text',
          // Penanda aktif: garis aksen 2px di tepi rail, tumbuh dari tengah saat berpindah bagian.
          'before:absolute before:top-2 before:bottom-2 before:-left-2 before:w-0.5 before:rounded-full before:bg-accent before:shadow-glow before:transition-transform before:duration-[180ms] before:ease-spring',
          active ? 'bg-accent-soft text-text before:scale-y-100' : 'before:scale-y-0',
        )}
      >
        {item.icon}
      </Link>
    </Tooltip>
  );
}

/** Rail kiri 56px: Chat, Project, Kanban, Jadwal, Riset di atas; Pengaturan di bawah. */
export function Rail() {
  return (
    <nav
      aria-label={copy.shell.rail}
      className="flex w-(--aios-rail-width) shrink-0 flex-col items-center justify-between border-r border-border bg-surface py-2"
    >
      <div className="flex flex-col items-center gap-1">
        <span
          role="img"
          aria-label={copy.shell.brand}
          className="mb-2 inline-flex size-9 items-center justify-center rounded-control bg-surface-2 text-accent shadow-glow"
        >
          <BrainCircuit size={18} strokeWidth={1.5} aria-hidden="true" />
        </span>
        {items.map((item) => (
          <RailLink key={item.to} item={item} />
        ))}
      </div>
      <RailLink item={settings} />
    </nav>
  );
}
