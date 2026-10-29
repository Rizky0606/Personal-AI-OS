import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useParams,
} from '@tanstack/react-router';
import { GeneralChatRoute, ProjectChatRoute } from '../workspace/ProjectRoutes';
import { CompareScreen } from '../compare/CompareScreen';
import { StatusScreen } from '../status/StatusScreen';
import { QuotaScreen } from '../quota/QuotaScreen';
import { KanbanScreen } from '../kanban/KanbanScreen';
import { WorkspaceScreen } from '../workspace/WorkspaceScreen';
import { ResearchDetailScreen } from '../research/ResearchDetailScreen';
import { ResearchFormScreen } from '../research/ResearchFormScreen';
import { CatalogScreen } from '../screens/CatalogScreen';
import { ProjectsScreen } from '../projects/ProjectsScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { ScheduleDetailScreen } from '../schedules/ScheduleDetailScreen';
import { SchedulesScreen } from '../schedules/SchedulesScreen';
import { Shell } from '../shell/Shell';
import { SpaceDetailScreen } from '../spaces/SpaceDetailScreen';
import { SpacesScreen } from '../spaces/SpacesScreen';

const rootRoute = createRootRoute({ component: Shell });

function ChatRoute() {
  const { conversationId } = useParams({ from: '/chat/$conversationId' });
  return <GeneralChatRoute conversationId={conversationId} />;
}

function ProjectRoute() {
  const { projectId } = useParams({ from: '/workspace/$projectId' });
  return <ProjectChatRoute projectId={projectId} conversationId={undefined} />;
}

function ProjectConversationRoute() {
  const { projectId, conversationId } = useParams({
    from: '/workspace/$projectId/$conversationId',
  });
  return <ProjectChatRoute projectId={projectId} conversationId={conversationId} />;
}

function ResearchRoute() {
  const { researchId } = useParams({ from: '/research/$researchId' });
  return <ResearchDetailScreen researchId={researchId} />;
}

function SpaceRoute() {
  const { spaceId } = useParams({ from: '/spaces/$spaceId' });
  return <SpaceDetailScreen spaceId={spaceId} />;
}

function ScheduleRoute() {
  const { scheduleId } = useParams({ from: '/schedules/$scheduleId' });
  return <ScheduleDetailScreen scheduleId={scheduleId} />;
}

const routes = [
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <GeneralChatRoute conversationId={undefined} />,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/chat/$conversationId',
    component: ChatRoute,
  }),
  createRoute({ getParentRoute: () => rootRoute, path: '/projects', component: ProjectsScreen }),
  createRoute({ getParentRoute: () => rootRoute, path: '/kanban', component: KanbanScreen }),
  createRoute({ getParentRoute: () => rootRoute, path: '/workspace', component: WorkspaceScreen }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/workspace/$projectId',
    component: ProjectRoute,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/workspace/$projectId/$conversationId',
    component: ProjectConversationRoute,
  }),
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
  createRoute({ getParentRoute: () => rootRoute, path: '/spaces', component: SpacesScreen }),
  createRoute({ getParentRoute: () => rootRoute, path: '/spaces/$spaceId', component: SpaceRoute }),
  createRoute({ getParentRoute: () => rootRoute, path: '/settings', component: SettingsScreen }),
  createRoute({ getParentRoute: () => rootRoute, path: '/quota', component: QuotaScreen }),
  createRoute({ getParentRoute: () => rootRoute, path: '/status', component: StatusScreen }),
  createRoute({ getParentRoute: () => rootRoute, path: '/compare', component: CompareScreen }),
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
  // Perpindahan layar memakai View Transitions bila peramban mendukung (CSS di shell/shell.css); jika tidak, tanpa animasi.
  defaultViewTransition: true,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
