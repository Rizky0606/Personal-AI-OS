import { useEffect } from 'react';
import { useAuthState } from './hooks';
import { localWorker, workerService } from './services';

/**
 * Worker sidecar hidup selama sudah login: sambungan lokal dimulai, lalu kredensial worker didaftarkan dan
 * diberikan otomatis. Saat keluar, keduanya dihentikan.
 */
export function WorkerLifecycle() {
  const signedIn = useAuthState().status === 'signedIn';

  useEffect(() => {
    if (!signedIn) return;
    localWorker.start();
    workerService.start();
    return () => {
      workerService.stop();
      localWorker.stop();
    };
  }, [signedIn]);

  return null;
}
