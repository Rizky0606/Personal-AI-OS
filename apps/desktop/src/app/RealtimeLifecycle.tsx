import { useEffect } from 'react';
import { queryClient } from './queryClient';
import { watchWake } from '../realtime/wake';
import { useAuthState } from './hooks';
import { handleUserEvent } from './userEvents';
import { auth, realtime } from './services';

/**
 * Menjalankan koneksi realtime selama sudah login, dan memeriksa ulang saat PC bangun dari tidur atau jaringan
 * kembali: token diperbarui bila hampir habis, soket diperiksa dan disambung ulang segera bila mati.
 */
export function RealtimeLifecycle() {
  const state = useAuthState();
  const signedIn = state.status === 'signedIn';

  // Keluar (atau sesi dicabut): buang cache supaya data akun lama tidak tersisa di memori.
  useEffect(() => {
    if (state.status === 'signedOut') queryClient.clear();
  }, [state.status]);

  useEffect(() => {
    if (!signedIn) {
      realtime.stop();
      return;
    }
    realtime.start();
    // Channel `user`: hasil jadwal dan riset yang selesai menyegarkan layar yang terbuka.
    const stopUser = realtime.subscribe('user', ({ event }) => handleUserEvent(event, queryClient));
    const stopWatching = watchWake(() => {
      void auth.refreshIfNeeded().finally(() => {
        realtime.reconnectNow();
        realtime.probe();
      });
    });
    return () => {
      stopUser();
      stopWatching();
      realtime.stop();
    };
  }, [signedIn]);

  return null;
}
