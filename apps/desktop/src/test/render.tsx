import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Toaster } from '../ui/Toaster';
import { TooltipProvider } from '../ui/Tooltip';

const PATHS = [
  '/',
  '/chat/$conversationId',
  '/schedules',
  '/schedules/$scheduleId',
  '/research',
  '/research/$researchId',
];

/**
 * Merender layar di dalam router memori, QueryClient baru (tanpa retry), tooltip, dan toaster.
 * Rute tujuan tautan didaftarkan kosong; `router.state.location.pathname` menunjukkan ke mana layar bernavigasi.
 */
export async function renderScreen(ui: ReactNode, path = '/') {
  const root = createRootRoute({
    component: () => (
      <>
        {ui}
        <Outlet />
      </>
    ),
  });
  const router = createRouter({
    routeTree: root.addChildren(
      PATHS.map((p) => createRoute({ getParentRoute: () => root, path: p, component: () => null })),
    ),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  await router.load();
  return { router, queryClient, ...view };
}
