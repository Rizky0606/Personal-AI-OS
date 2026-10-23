import { useQuery } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { localWorker, workerApi } from '../app/services';
import { api } from '../app/services';
import type { WorkerSnapshot } from './localClient';

export const useWorker = (): WorkerSnapshot =>
  useSyncExternalStore(localWorker.subscribe, localWorker.getSnapshot);

/** Folder yang diizinkan; hanya diambil saat worker lokal tersambung dan diambil ulang tiap kali tersambung baru. */
export function useAllowedFolders() {
  const connected = useWorker().local === 'connected';
  return useQuery({
    queryKey: ['worker', 'folders', connected],
    queryFn: workerApi.folders,
    enabled: connected,
  });
}

/** Ikatan project ke folder di PC ini. */
export function useBindings() {
  const connected = useWorker().local === 'connected';
  return useQuery({
    queryKey: ['worker', 'bindings', connected],
    queryFn: workerApi.bindings,
    enabled: connected,
  });
}

/** Project terdaftar di server (semua perangkat). */
export const useProjects = () => useQuery({ queryKey: ['projects'], queryFn: api.listProjects });
