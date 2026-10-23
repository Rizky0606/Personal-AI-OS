import { createGatewayApi } from '../api/gateway';
import { AuthSession } from '../auth/authSession';
import { SessionVault, createSecretStore } from '../auth/secretStore';
import { httpFetch } from '../lib/http';
import { isTauri } from '../lib/tauri';
import { RealtimeClient } from '../realtime/client';
import { RunTracker } from '../realtime/runTracker';
import { browserOpen, tauriOpen } from '../realtime/tauriTransport';
import { finishRun } from './finishRun';
import { queryClient } from './queryClient';

async function deviceName(): Promise<string> {
  if (!isTauri()) return 'Windows PC (dev)';
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('device_name');
}

/** Satu sesi dan satu koneksi realtime untuk seluruh aplikasi. */
export const auth = new AuthSession({
  vault: new SessionVault(createSecretStore()),
  fetcher: httpFetch,
  deviceName,
});

export const realtime = new RealtimeClient({
  open: isTauri() ? tauriOpen : browserOpen,
  serverUrl: () => {
    const state = auth.getState();
    return state.status === 'signedIn' ? state.session.serverUrl : null;
  },
  token: () => auth.validAccessToken(),
  refreshed: (stale) => auth.refreshAfterUnauthorized(stale),
});

/** Klien REST untuk fitur chat, riset, dan jadwal. */
export const api = createGatewayApi((path, init) => auth.authedFetch(path, init));

/** Pelacak run yang hidup selama aplikasi, bukan selama satu layar. */
export const runs: RunTracker = new RunTracker({
  realtime,
  fetchRun: api.getRun,
  onFinished: (run) => void finishRun(run, { queryClient, release: (id) => runs.release(id) }),
});
