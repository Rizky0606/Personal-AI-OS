import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useParams,
} from '@tanstack/react-router';
import { ChatScreen } from '../chat/ChatScreen';
import { KanbanScreen } from '../kanban/KanbanScreen';
import { ResearchDetailScreen } from '../research/ResearchDetailScreen';
import { ResearchFormScreen } from '../research/ResearchFormScreen';
import { CatalogScreen } from '../screens/CatalogScreen';
import { ProjectsScreen } from '../projects/ProjectsScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { ScheduleDetailScreen } from '../schedules/ScheduleDetailScreen';
import { SchedulesScreen } from '../schedules/SchedulesScreen';
import { Shell } from '../shell/Shell';

const rootRoute = createRootRoute({ component: Shell });

function ChatRoute() {
  const { conversationId } = useParams({ from: '/chat/$conversationId' });
  return <ChatScreen conversationId={conversationId} />;
}

function ResearchRoute() {
  const { researchId } = useParams({ from: '/research/$researchId' });
  return <ResearchDetailScreen researchId={researchId} />;
}

function ScheduleRoute() {
  const { scheduleId } = useParams({ from: '/schedules/$scheduleId' });
  return <ScheduleDetailScreen scheduleId={scheduleId} />;
}

const routes = [
  createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => <ChatScreen /> }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/chat/$conversationId',
    component: ChatRoute,
  }),
  createRoute({ getParentRoute: () => rootRoute, path: '/projects', component: ProjectsScreen }),
  createRoute({ getParentRoute: () => rootRoute, path: '/kanban', component: KanbanScreen }),
  createRoute({ getParentRoute: () => rootRoute, path: '/schedules', component: SchedulesScreen }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/schedules/$scheduleId',
    component: ScheduleRoute,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/research',
    component: ResearchFormScreen,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/research/$researchId',
    component: ResearchRoute,
  }),
  createRoute({ getParentRoute: () => rootRoute, path: '/settings', component: SettingsScreen }),
  // Katalog komponen hanya ada di mode dev.
  ...(import.meta.env.DEV
    ? [
        createRoute({
          getParentRoute: () => rootRoute,
          path: '/dev/catalog',
          component: CatalogScreen,
        }),
      ]
    : []),
];

/** Hash history: berjalan benar dari berkas/protokol Tauri tanpa server yang menangani path. */
export const router = createRouter({
  routeTree: rootRoute.addChildren(routes),
  history: createHashHistory(),
  defaultPreload: false,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
