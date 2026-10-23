import { useSyncExternalStore } from 'react';
import type { AuthState } from '../auth/authSession';
import type { ConnectionState } from '../realtime/client';
import { auth, realtime } from './services';

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
