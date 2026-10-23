import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { LoginScreen } from '../screens/LoginScreen';
import { applyTheme, useUiStore } from '../state/uiStore';
import { Toaster } from '../ui/Toaster';
import { TooltipProvider } from '../ui/Tooltip';
import { useAuthState } from './hooks';
import { RealtimeLifecycle } from './RealtimeLifecycle';
import { router } from './router';
import { auth } from './services';

const LAST_SERVER_KEY = 'aios.lastServer';

function readLastServer(): string {
  try {
    return localStorage.getItem(LAST_SERVER_KEY) ?? '';
  } catch {
    return '';
  }
}

/** Gerbang sesi: memuat -> login -> aplikasi. Setelah login pertama, aplikasi masuk otomatis (token di Credential Manager). */
export function App() {
  const state = useAuthState();
  const theme = useUiStore((s) => s.theme);
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000 } } }),
  );

  useEffect(() => {
    void auth.init();
  }, []);

  useEffect(() => applyTheme(theme), [theme]);

  useEffect(() => {
    if (state.status !== 'signedIn') return;
    try {
      localStorage.setItem(LAST_SERVER_KEY, state.session.serverUrl);
    } catch {
      // Penyimpanan tidak tersedia; alamat hanya tidak terisi otomatis.
    }
  }, [state]);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={400}>
        <RealtimeLifecycle />
        {state.status === 'loading' ? (
          <div className="h-full bg-bg" />
        ) : state.status === 'signedOut' ? (
          <LoginScreen initialServer={readLastServer()} />
        ) : (
          <RouterProvider router={router} />
        )}
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
