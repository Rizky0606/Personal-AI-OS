import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useModels, useSchedules, useTasks } from '../api/queries';
import { api } from '../app/services';
import { copy } from '../copy';
import { useUiStore, type RightPanelTab, type ThemeMode } from '../state/uiStore';
import { useProjects } from '../worker/hooks';
import type { PaletteItem } from './rank';

const PANELS: RightPanelTab[] = ['preview', 'diff', 'terminal'];
const THEMES: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: copy.settings.themeSystem },
  { value: 'light', label: copy.settings.themeLight },
  { value: 'dark', label: copy.settings.themeDark },
];

/**
 * Semua yang bisa dicari atau dijalankan dari palet: perintah, navigasi, panel, percakapan, project, kartu
 * (project aktif), jadwal, model, dan tema. Data dimuat hanya saat palet terbuka.
 */
export function usePaletteItems(open: boolean, close: () => void): PaletteItem[] {
  const navigate = useNavigate();
  const projects = useProjects().data;
  const models = useModels().data;
  const schedules = useSchedules().data;
  const activeProjectId = useUiStore((s) => s.activeProjectId);
  const tasks = useTasks(activeProjectId).data;
  const conversations = useQuery({
    queryKey: ['palette', 'conversations'],
    queryFn: () => api.listConversations(),
    enabled: open,
    staleTime: 30_000,
  }).data;

  return useMemo(() => {
    const ui = useUiStore.getState();
    const done = (action: () => void) => () => {
      close();
      action();
    };
    const go = (
      to:
        | '/'
        | '/projects'
        | '/kanban'
        | '/schedules'
        | '/research'
        | '/settings'
        | '/quota'
        | '/compare'
        | '/status',
    ) => done(() => void navigate({ to }));
    const items: PaletteItem[] = [
      {
        id: 'new-chat',
        group: 'action',
        label: copy.palette.newChat,
        hint: 'Ctrl+N',
        run: done(() => {
          ui.requestNewChat();
          void navigate({ to: '/' });
        }),
      },
      {
        id: 'new-research',
        group: 'action',
        label: copy.palette.newResearch,
        run: go('/research'),
      },
      {
        id: 'toggle-panel',
        group: 'action',
        label: copy.palette.togglePanel,
        hint: 'Ctrl+J',
        run: done(() => useUiStore.getState().toggleRightPanel()),
      },
      {
        id: 'toggle-sidebar',
        group: 'action',
        label: copy.palette.toggleSidebar,
        hint: 'Ctrl+B',
        run: done(() => useUiStore.getState().toggleSidebar()),
      },
      { id: 'go-chat', group: 'go', label: copy.nav.chat, hint: 'Ctrl+1', run: go('/') },
      {
        id: 'go-projects',
        group: 'go',
        label: copy.nav.projects,
        hint: 'Ctrl+2',
        run: go('/projects'),
      },
      { id: 'go-kanban', group: 'go', label: copy.nav.kanban, hint: 'Ctrl+3', run: go('/kanban') },
      {
        id: 'go-schedules',
        group: 'go',
        label: copy.nav.schedules,
        hint: 'Ctrl+4',
        run: go('/schedules'),
      },
      {
        id: 'go-research',
        group: 'go',
        label: copy.nav.research,
        hint: 'Ctrl+5',
        run: go('/research'),
      },
      {
        id: 'go-settings',
        group: 'go',
        label: copy.nav.settings,
        hint: 'Ctrl+6',
        run: go('/settings'),
      },
      {
        id: 'go-status',
        group: 'go',
        label: copy.status.page.title,
        keywords: 'versi kesehatan antrean worker dependensi',
        run: go('/status'),
      },
      { id: 'go-quota', group: 'go', label: copy.quota.title, run: go('/quota') },
      {
        id: 'go-compare',
        group: 'go',
        label: copy.compare.title,
        keywords: 'bandingkan model',
        run: go('/compare'),
      },
      ...PANELS.map<PaletteItem>((tab) => ({
        id: `panel-${tab}`,
        group: 'panel',
        label: copy.palette.openPanel(copy.shell.panels[tab]),
        run: done(() => useUiStore.getState().openPanel(tab)),
      })),
      ...THEMES.map<PaletteItem>((t) => ({
        id: `theme-${t.value}`,
        group: 'theme',
        label: copy.palette.themeTo(t.label),
        keywords: 'tema warna gelap terang',
        run: done(() => useUiStore.getState().setTheme(t.value)),
      })),
      {
        id: 'model-auto',
        group: 'model',
        label: copy.palette.autoModel,
        run: done(() => useUiStore.getState().setModel(null)),
      },
      ...(models ?? []).map<PaletteItem>((m) => ({
        id: `model-${m.id}`,
        group: 'model',
        label: copy.palette.useModel(m.label),
        hint: m.kind,
        run: done(() => useUiStore.getState().setModel(m.id)),
      })),
      {
        id: 'project-none',
        group: 'project',
        label: copy.palette.generalChat,
        run: done(() => {
          useUiStore.getState().setActiveProject(null);
          void navigate({ to: '/' });
        }),
      },
      ...(projects ?? []).map<PaletteItem>((p) => ({
        id: `project-${p.id}`,
        group: 'project',
        label: copy.palette.switchProject(p.name),
        keywords: p.name,
        run: done(() => {
          useUiStore.getState().setActiveProject(p.id);
          void navigate({ to: '/' });
        }),
      })),
      ...(conversations?.items ?? []).map<PaletteItem>((c) => ({
        id: `conversation-${c.id}`,
        group: 'conversation',
        label: c.title || copy.palette.untitled,
        run: done(
          () => void navigate({ to: '/chat/$conversationId', params: { conversationId: c.id } }),
        ),
      })),
      ...(tasks ?? []).map<PaletteItem>((t) => ({
        id: `task-${t.id}`,
        group: 'task',
        label: t.title,
        hint: copy.palette.taskIn(copy.kanban.columns[t.status]),
        run: done(() => void navigate({ to: '/kanban' })),
      })),
      ...(schedules ?? []).map<PaletteItem>((s) => ({
        id: `schedule-${s.id}`,
        group: 'schedule',
        label: s.name,
        hint: s.cron,
        run: done(
          () => void navigate({ to: '/schedules/$scheduleId', params: { scheduleId: s.id } }),
        ),
      })),
    ];
    return items;
  }, [navigate, close, projects, models, schedules, tasks, conversations]);
}
