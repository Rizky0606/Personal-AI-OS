import { useEffect } from 'react';
import { watchWake } from '../realtime/wake';
import { useAuthState } from './hooks';
import { auth, realtime } from './services';

/**
 * Menjalankan koneksi realtime selama sudah login, dan memeriksa ulang saat PC bangun dari tidur atau jaringan
 * kembali: token diperbarui bila hampir habis, soket diperiksa dan disambung ulang segera bila mati.
 */
export function RealtimeLifecycle() {
  const state = useAuthState();
  const signedIn = state.status === 'signedIn';

  useEffect(() => {
    if (!signedIn) {
      realtime.stop();
      return;
    }
    realtime.start();
    const stopWatching = watchWake(() => {
      void auth.refreshIfNeeded().finally(() => {
        realtime.reconnectNow();
        realtime.probe();
      });
    });
    return () => {
      stopWatching();
      realtime.stop();
    };
  }, [signedIn]);

  return null;
}
