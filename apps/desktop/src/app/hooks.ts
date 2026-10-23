import { useSyncExternalStore } from 'react';
import type { AuthState } from '../auth/authSession';
import type { ConnectionState } from '../realtime/client';
import type { LiveRun, RunFailure } from '../realtime/liveRun';
import { auth, realtime, runs } from './services';

export const useAuthState = (): AuthState => useSyncExternalStore(auth.subscribe, auth.getState);

export const useConnection = (): ConnectionState =>
  useSyncExternalStore(realtime.subscribeState, realtime.getState);

const subscribeOnline = (listener: () => void) => {
  window.addEventListener('online', listener);
  window.addEventListener('offline', listener);
  return () => {
    window.removeEventListener('online', listener);
    window.removeEventListener('offline', listener);
  };
};

/** Koneksi internet perangkat (bukan status gateway). */
export const useOnline = (): boolean =>
  useSyncExternalStore(subscribeOnline, () => navigator.onLine);

const noSubscribe = () => () => undefined;

/** Keadaan live satu run dari pelacak (bertahan walau layar berganti). */
export const useLiveRun = (runId: string | null | undefined): LiveRun | undefined =>
  useSyncExternalStore(runId ? (listener) => runs.subscribe(runId, listener) : noSubscribe, () =>
    runId ? runs.get(runId) : undefined,
  );

/** Kegagalan run yang terjadi di sesi ini. */
export const useRunFailure = (runId: string | null | undefined): RunFailure | undefined =>
  useSyncExternalStore(runId ? (listener) => runs.subscribe(runId, listener) : noSubscribe, () =>
    runId ? runs.failureOf(runId) : undefined,
  );
