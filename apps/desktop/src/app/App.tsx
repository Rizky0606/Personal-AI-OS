import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useEffect } from 'react';
import { LoginScreen } from '../screens/LoginScreen';
import { applyTheme, useUiStore } from '../state/uiStore';
import { Toaster } from '../ui/Toaster';
import { TooltipProvider } from '../ui/Tooltip';
import { useAuthState } from './hooks';
import { queryClient } from './queryClient';
import { QuickAskLifecycle } from './QuickAskLifecycle';
import { ShellSkeleton } from '../shell/ShellSkeleton';
import { RealtimeLifecycle } from './RealtimeLifecycle';
import { WorkerLifecycle } from './WorkerLifecycle';
import { router } from './router';
import { auth } from './services';

const LAST_SERVER_KEY = 'aios.lastServer';
/** Alamat gateway tertanam saat build (VITE_GATEWAY_URL); kosong berarti alamat diketik di layar login. */
const builtInServer = (import.meta.env.VITE_GATEWAY_URL as string | undefined)?.trim();
const BUILT_IN_SERVER = builtInServer?.length ? builtInServer : undefined;

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
        <WorkerLifecycle />
        {state.status === 'loading' ? (
          <ShellSkeleton />
        ) : state.status === 'signedOut' ? (
          <LoginScreen initialServer={readLastServer()} fixedServer={BUILT_IN_SERVER} />
        ) : (
          <>
            <RouterProvider router={router} />
            <QuickAskLifecycle />
          </>
        )}
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
