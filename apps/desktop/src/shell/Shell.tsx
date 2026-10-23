import { Outlet, useRouterState } from '@tanstack/react-router';
import { PanelLeftOpen, PanelRight } from 'lucide-react';
import { useMemo } from 'react';
import { copy } from '../copy';
import { useUiStore } from '../state/uiStore';
import { IconButton } from '../ui/IconButton';
import { CommandPalette } from './CommandPalette';
import { Rail } from './Rail';
import { RightPanel } from './RightPanel';
import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';
import { useShortcuts } from './useShortcuts';

interface Section {
  title: string;
  sidebarEmpty: string;
}

/** Judul bagian dan teks kosong sidebar menurut rute aktif. */
function sectionFor(pathname: string): Section {
  if (pathname.startsWith('/projects'))
    return { title: copy.nav.projects, sidebarEmpty: copy.screens.projectsEmpty };
  if (pathname.startsWith('/kanban'))
    return { title: copy.nav.kanban, sidebarEmpty: copy.screens.kanbanEmpty };
  if (pathname.startsWith('/schedules'))
    return { title: copy.nav.schedules, sidebarEmpty: copy.screens.schedulesEmpty };
  if (pathname.startsWith('/research'))
    return { title: copy.nav.research, sidebarEmpty: copy.screens.researchEmpty };
  if (pathname.startsWith('/settings'))
    return { title: copy.nav.settings, sidebarEmpty: copy.settings.shortcuts };
  if (pathname.startsWith('/dev'))
    return { title: copy.nav.catalog, sidebarEmpty: copy.nav.catalog };
  return { title: copy.nav.chat, sidebarEmpty: copy.screens.chatEmpty };
}

/**
 * Kerangka final: rail 56px, sidebar 260px (ciut), area utama, panel kanan bertab (lebar bisa diubah), status bar 24px.
 */
export function Shell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const rightPanelOpen = useUiStore((s) => s.rightPanelOpen);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const toggleRightPanel = useUiStore((s) => s.toggleRightPanel);
  const setPaletteOpen = useUiStore((s) => s.setPaletteOpen);
  const requestNewChat = useUiStore((s) => s.requestNewChat);

  const actions = useMemo(
    () => ({
      palette: () => setPaletteOpen(true),
      newChat: requestNewChat,
      toggleSidebar,
      toggleRightPanel,
    }),
    [setPaletteOpen, requestNewChat, toggleSidebar, toggleRightPanel],
  );
  useShortcuts(actions);
  const section = sectionFor(pathname);

  return (
    <div className="flex h-full flex-col bg-bg text-text">
      <div className="flex min-h-0 flex-1">
        <Rail />
        {sidebarOpen ? <Sidebar title={section.title} emptyMessage={section.sidebarEmpty} /> : null}
        <main aria-label={copy.shell.mainArea} className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-2">
            <div className="flex items-center gap-2">
              {sidebarOpen ? null : (
                <IconButton label={copy.shell.expandSidebar} onClick={toggleSidebar}>
                  <PanelLeftOpen size={16} strokeWidth={1.5} aria-hidden="true" />
                </IconButton>
              )}
              <h1 className="text-ui font-semibold text-text">{section.title}</h1>
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
          <div className="min-h-0 flex-1 overflow-auto">
            <Outlet />
          </div>
        </main>
        {rightPanelOpen ? <RightPanel /> : null}
      </div>
      <StatusBar />
      <CommandPalette />
    </div>
  );
}
