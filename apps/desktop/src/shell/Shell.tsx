import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { ConversationList } from '../chat/ConversationList';
import { ProjectSwitcher } from '../chat/ProjectSwitcher';
import { goHome } from '../chat/paths';
import { copy } from '../copy';
import { WorkspaceSidebar } from '../workspace/WorkspaceSidebar';
import { ResearchList } from '../research/ResearchList';
import { ScheduleList } from '../schedules/ScheduleList';
import { SpaceList } from '../spaces/SpaceList';
import { useUiStore } from '../state/uiStore';
import { InfoNote } from '../ui/InfoNote';
import { CommandPalette } from './CommandPalette';
import { ConnectionBanner } from './ConnectionBanner';
import { ISLAND } from './island';
import { isChatPath } from './navItems';
import { routeForSlot } from './navRoutes';
import { RightPanel } from './RightPanel';
import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';
import { Topbar } from './Topbar';
import { useShortcuts } from './useShortcuts';

interface Section {
  title: string;
  /** Isi sidebar bagian ini. */
  list: ReactNode;
  /** Aksi utama di header sidebar. */
  action?: { label: string; to: '/' | '/research' };
}

/** Judul bagian dan isi sidebar menurut rute aktif. */
function sectionFor(pathname: string): Section {
  if (pathname.startsWith('/projects'))
    return { title: copy.workspace.manage, list: <WorkspaceSidebar /> };
  if (pathname.startsWith('/kanban'))
    return {
      title: copy.nav.kanban,
      list: (
        <>
          <ProjectSwitcher to="/kanban" allowGeneral={false} />
          <InfoNote message={copy.kanban.sidebarHint} />
        </>
      ),
    };
  if (pathname.startsWith('/workspace'))
    return { title: copy.nav.workspace, list: <WorkspaceSidebar /> };
  if (pathname.startsWith('/schedules'))
    return { title: copy.nav.schedules, list: <ScheduleList /> };
  if (pathname.startsWith('/research'))
    return {
      title: copy.nav.research,
      list: <ResearchList />,
      action: { label: copy.research.newResearch, to: '/research' },
    };
  if (pathname.startsWith('/spaces')) return { title: copy.nav.spaces, list: <SpaceList /> };
  if (pathname.startsWith('/status'))
    return {
      title: copy.status.page.title,
      list: <InfoNote message={copy.status.page.sidebar} />,
    };
  if (pathname.startsWith('/quota'))
    return { title: copy.quota.title, list: <InfoNote message={copy.quota.empty} /> };
  if (pathname.startsWith('/compare'))
    return { title: copy.compare.title, list: <InfoNote message={copy.compare.intro} /> };
  if (pathname.startsWith('/settings'))
    return { title: copy.nav.settings, list: <InfoNote message={copy.settings.shortcuts} /> };
  if (pathname.startsWith('/dev'))
    return { title: copy.nav.catalog, list: <InfoNote message={copy.nav.catalog} /> };
  return {
    title: copy.nav.chat,
    list: <ConversationList />,
    action: { label: copy.chat.newChat, to: '/' },
  };
}

/**
 * Kerangka "pulau": kanvas `bg` dengan sidebar (navigasi + daftar konteks), area utama (topbar + isi), dan panel
 * kanan bertab sebagai panel melayang berjarak 8 px; kaki status di kanvas. Perpindahan layar memakai View
 * Transitions pada pembungkus isi (`aios-page-transition`, lihat shell.css), dengan fallback tanpa animasi.
 */
export function Shell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const rightPanelOpen = useUiStore((s) => s.rightPanelOpen);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const toggleRightPanel = useUiStore((s) => s.toggleRightPanel);
  const setPaletteOpen = useUiStore((s) => s.setPaletteOpen);
  const requestNewChat = useUiStore((s) => s.requestNewChat);
  const newChatSignal = useUiStore((s) => s.newChatSignal);

  // Ctrl+N dari layar mana pun membuka chat baru.
  const lastSignal = useRef(newChatSignal);
  useEffect(() => {
    if (newChatSignal === lastSignal.current) return;
    lastSignal.current = newChatSignal;
    // Di tab Project, chat baru dibuka di project yang sedang dipilih.
    const inProject = pathname.startsWith('/workspace/');
    void goHome(navigate, inProject ? useUiStore.getState().activeProjectId : null);
  }, [newChatSignal, navigate, pathname]);

  const actions = useMemo(
    () => ({
      palette: () => setPaletteOpen(true),
      newChat: requestNewChat,
      toggleSidebar,
      toggleRightPanel,
      navigate: (slot: number) => {
        const target = routeForSlot(slot);
        if (target) void navigate({ to: target });
      },
    }),
    [setPaletteOpen, requestNewChat, toggleSidebar, toggleRightPanel, navigate],
  );
  useShortcuts(actions);
  const section = sectionFor(pathname);
  const sectionAction = section.action;

  return (
    <div className="flex h-full flex-col bg-bg text-text">
      <div className="flex min-h-0 flex-1 gap-(--aios-island-gap) p-(--aios-island-gap)">
        <Sidebar title={section.title}>{section.list}</Sidebar>
        <main
          aria-label={copy.shell.mainArea}
          className={`${ISLAND} flex min-w-0 flex-1 flex-col overflow-hidden`}
        >
          <Topbar
            title={section.title}
            chat={isChatPath(pathname)}
            action={
              sectionAction
                ? {
                    label: sectionAction.label,
                    onSelect: () => {
                      if (sectionAction.to === '/') requestNewChat();
                      else void navigate({ to: '/research' });
                    },
                  }
                : undefined
            }
            rightPanelOpen={rightPanelOpen}
            onToggleRightPanel={toggleRightPanel}
          />
          <ConnectionBanner />
          <div className="aios-page-transition min-h-0 flex-1 overflow-auto">
            <Outlet />
          </div>
        </main>
        <RightPanel open={rightPanelOpen} />
      </div>
      <StatusBar />
      <CommandPalette />
    </div>
  );
}
