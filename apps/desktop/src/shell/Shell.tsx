import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ConversationList } from '../chat/ConversationList';
import { ProjectSwitcher } from '../chat/ProjectSwitcher';
import { goHome } from '../chat/paths';
import { copy } from '../copy';
import { WorkspaceSidebar } from '../workspace/WorkspaceSidebar';
import { ResearchList } from '../research/ResearchList';
import { ScheduleList } from '../schedules/ScheduleList';
import { SpaceList } from '../spaces/SpaceList';
import { useUiStore } from '../state/uiStore';
import { IconButton } from '../ui/IconButton';
import { ScreenTitleContext } from '../ui/screenTitle';
import { CommandPalette } from './CommandPalette';
import { ISLAND } from './island';
import { RightPanel } from './RightPanel';
import { Sidebar } from './Sidebar';
import { ConnectionBanner } from './ConnectionBanner';
import { Topbar } from './Topbar';
import { isChatPath } from './navItems';
import { cn } from '../lib/cn';
import { routeForSlot } from './navRoutes';
import { InfoNote } from '../ui/InfoNote';
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
    return { title: copy.workspace.manage, list: <WorkspaceSidebar addInMain /> };
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
 * Kerangka pulau: kanvas `bg` berisi tiga pulau (sidebar 232 px / ringkas 64 px, area utama dengan topbar 48 px
 * di dalamnya, dan panel kanan bertab yang lebarnya bisa diubah), berjarak `--aios-island-gap` ke tepi jendela dan
 * antar pulau. Topbar adalah satu-satunya pemilik judul layar (h1); PageHeader layar mendaftarkan judulnya ke sini.
 */
export function Shell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const rightPanelOpen = useUiStore((s) => s.rightPanelOpen);
  // Judul dari PageHeader layar aktif; null = pakai nama bagian.
  const [screenTitle, setScreenTitle] = useState<string | null>(null);
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
      openProgress: () => useUiStore.getState().openPanel('progress'),
      navigate: (slot: number) => {
        const target = routeForSlot(slot);
        if (target) void navigate({ to: target });
      },
    }),
    [setPaletteOpen, requestNewChat, toggleSidebar, toggleRightPanel, navigate],
  );
  useShortcuts(actions);
  const section = sectionFor(pathname);
  const sectionKey = pathname;
  return (
    <ScreenTitleContext.Provider value={setScreenTitle}>
      <div
        data-shell-canvas
        className="flex h-full gap-(--aios-island-gap) bg-bg p-(--aios-island-gap) text-text"
      >
        <Sidebar
          title={section.title}
          action={
            section.action ? (
              <IconButton
                label={section.action.label}
                onClick={() => {
                  if (section.action?.to === '/') requestNewChat();
                  else void navigate({ to: '/research' });
                }}
              >
                <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
              </IconButton>
            ) : undefined
          }
        >
          {section.list}
        </Sidebar>
        <main
          aria-label={copy.shell.mainArea}
          className={cn(ISLAND, 'flex min-w-0 flex-1 flex-col overflow-hidden')}
        >
          <Topbar
            title={screenTitle ?? section.title}
            chat={isChatPath(pathname)}
            rightPanelOpen={rightPanelOpen}
            onToggleRightPanel={toggleRightPanel}
          />
          <ConnectionBanner />
          <div key={sectionKey} className="min-h-0 flex-1 animate-aios-fade overflow-auto">
            <Outlet />
          </div>
        </main>
        <RightPanel open={rightPanelOpen} />
        <CommandPalette />
      </div>
    </ScreenTitleContext.Provider>
  );
}
