import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { PanelLeftOpen, PanelRight, Plus } from 'lucide-react';
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
import { IconButton } from '../ui/IconButton';
import { InfoNote } from '../ui/InfoNote';
import { CommandPalette } from './CommandPalette';
import { routeForSlot } from './navRoutes';
import { Rail } from './Rail';
import { RightPanel } from './RightPanel';
import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';
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
 * Kerangka final: rail 56px, sidebar 260px (ciut), area utama, panel kanan bertab (lebar bisa diubah), status bar 24px.
 */
export function Shell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
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
  // Isi area utama memudar masuk saat berpindah bagian; berpindah percakapan di dalam Chat tidak dihitung.
  const sectionKey = pathname === '/' ? 'chat' : (pathname.split('/')[1] ?? '');

  return (
    <div className="flex h-full flex-col bg-bg text-text">
      <div className="flex min-h-0 flex-1">
        <Rail />
        {sidebarOpen ? (
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
        ) : null}
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
          <div key={sectionKey} className="min-h-0 flex-1 animate-aios-fade overflow-auto">
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
