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

/** Urutan navigasi utama; Ctrl+1..6 mengikuti `NAV_ROUTES` (navRoutes.ts), Ruang tanpa pintasan angka. */
export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: copy.nav.chat, icon: <MessageSquare {...ICON} /> },
  { to: '/workspace', label: copy.nav.workspace, icon: <Folder {...ICON} /> },
  { to: '/kanban', label: copy.nav.kanban, icon: <Kanban {...ICON} /> },
  { to: '/schedules', label: copy.nav.schedules, icon: <CalendarClock {...ICON} /> },
  { to: '/research', label: copy.nav.research, icon: <Search {...ICON} /> },
  { to: '/spaces', label: copy.nav.spaces, icon: <Library {...ICON} /> },
];

/** Chat active in root and chat routes; other sections match descendants. */
export const isActive = (to: string, pathname: string): boolean => {
  if (to === '/') return pathname === '/' || pathname.startsWith('/chat');
  if (to === '/workspace')
    return pathname.startsWith('/workspace') || pathname.startsWith('/projects');
  return pathname === to || pathname.startsWith(`${to}/`);
};

export const isNavActive = isActive;

/** Pengaturan: tautan di kaki sidebar. */
export const settingsItem: NavItem = {
  to: '/settings',
  label: copy.nav.settings,
  icon: <Settings {...ICON} />,
};

/** Rute chat (percakapan umum atau di dalam project): topbar menampilkan project, model, dan koneksi. */
export const isChatPath = (pathname: string): boolean =>
  pathname === '/' || pathname.startsWith('/chat') || /^\/workspace\/[^/]+\/[^/]+/.test(pathname);
