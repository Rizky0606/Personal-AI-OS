import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { copy } from '../copy';
import { CatalogScreen } from '../screens/CatalogScreen';
import { PlaceholderScreen } from '../screens/PlaceholderScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { Shell } from '../shell/Shell';

const rootRoute = createRootRoute({ component: Shell });

const placeholder = <P extends string>(path: P, emptyMessage: string) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path,
    component: () => <PlaceholderScreen emptyMessage={emptyMessage} />,
  });

const routes = [
  placeholder('/', copy.screens.chatEmpty),
  placeholder('/projects', copy.screens.projectsEmpty),
  placeholder('/kanban', copy.screens.kanbanEmpty),
  placeholder('/schedules', copy.screens.schedulesEmpty),
  placeholder('/research', copy.screens.researchEmpty),
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
