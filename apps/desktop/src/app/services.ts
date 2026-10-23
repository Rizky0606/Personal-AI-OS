import { createGatewayApi } from '../api/gateway';
import { AuthSession } from '../auth/authSession';
import { SessionVault, createSecretStore } from '../auth/secretStore';
import { httpFetch } from '../lib/http';
import { isTauri } from '../lib/tauri';
import { RealtimeClient } from '../realtime/client';
import { RunTracker } from '../realtime/runTracker';
import { browserOpen, tauriOpen } from '../realtime/tauriTransport';
import { createWorkerApi } from '../worker/api';
import { LocalWorkerClient } from '../worker/localClient';
import { WorkerService } from '../worker/workerService';
import { WorkerVault } from '../worker/workerVault';
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

/** Klien REST untuk fitur chat, riset, jadwal, dan project. */
export const api = createGatewayApi((path, init) => auth.authedFetch(path, init));

/** Pelacak run yang hidup selama aplikasi, bukan selama satu layar. */
export const runs: RunTracker = new RunTracker({
  realtime,
  fetchRun: api.getRun,
  onFinished: (run) => void finishRun(run, { queryClient, release: (id) => runs.release(id) }),
});

/** Port dan token sekali pakai untuk worker lokal; Tauri memulai (atau memulai ulang) proses worker. */
async function workerConnectInfo(): Promise<{ port: number; token: string }> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<{ port: number; token: string }>('worker_connect_info');
}

/** Sambungan ke worker sidecar lokal. Di peramban biasa (vite dev) tidak ada worker: gagal dengan jelas. */
export const localWorker = new LocalWorkerClient({
  connectInfo: isTauri()
    ? workerConnectInfo
    : () => Promise.reject(new Error('Worker hanya tersedia di aplikasi desktop.')),
  open: isTauri() ? tauriOpen : browserOpen,
});

export const workerApi = createWorkerApi((method, params) => localWorker.call(method, params));

/** Mendaftarkan dan memberikan kredensial worker otomatis setelah login. */
export const workerService = new WorkerService({
  client: localWorker,
  auth,
  vault: new WorkerVault(createSecretStore()),
  register: api.registerWorker,
});
