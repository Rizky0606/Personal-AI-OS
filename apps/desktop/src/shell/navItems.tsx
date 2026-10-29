import {
  CalendarClock,
  Folder,
  Kanban,
  Library,
  MessageSquare,
  Search,
  Settings,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { copy } from '../copy';

export interface NavItem {
  to: '/' | '/kanban' | '/workspace' | '/schedules' | '/research' | '/spaces' | '/settings';
  label: string;
  icon: ReactNode;
}

const ICON = { size: 18, strokeWidth: 1.5, 'aria-hidden': true } as const;

/** Enam bagian utama sidebar, dari atas ke bawah. */
export const navItems: NavItem[] = [
  { to: '/', label: copy.nav.chat, icon: <MessageSquare {...ICON} /> },
  { to: '/workspace', label: copy.nav.workspace, icon: <Folder {...ICON} /> },
  { to: '/kanban', label: copy.nav.kanban, icon: <Kanban {...ICON} /> },
  { to: '/schedules', label: copy.nav.schedules, icon: <CalendarClock {...ICON} /> },
  { to: '/research', label: copy.nav.research, icon: <Search {...ICON} /> },
  { to: '/spaces', label: copy.nav.spaces, icon: <Library {...ICON} /> },
];

/** Pengaturan: tautan di kaki sidebar. */
export const settingsItem: NavItem = {
  to: '/settings',
  label: copy.nav.settings,
  icon: <Settings {...ICON} />,
};

/** Chat aktif di "/" dan di "/chat/<id>"; bagian lain aktif untuk rute turunannya. */
export function isActive(to: string, pathname: string): boolean {
  if (to === '/') return pathname === '/' || pathname.startsWith('/chat');
  // Pengelolaan project adalah bagian dari tab Project.
  if (to === '/workspace')
    return pathname.startsWith('/workspace') || pathname.startsWith('/projects');
  return pathname === to || pathname.startsWith(`${to}/`);
}
