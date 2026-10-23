import type { PreviewInfo, PreviewTarget } from '@aios/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { localWorker, workerApi } from '../app/services';
import { useUiStore } from '../state/uiStore';
import { workerErrorMessage } from '../worker/errors';
import { useWorker } from '../worker/hooks';

/** Preview yang dimulai dari panel dihentikan setelah panel ditutup, dengan jeda supaya pindah tab sebentar tidak mematikannya. */
export const STOP_GRACE_MS = 30_000;
const startedHere = new Map<string, ReturnType<typeof setTimeout> | undefined>();

const keyOf = (t: PreviewTarget) => (t.runId ? `run:${t.runId}` : `project:${t.projectId}`);
const queryKey = (t: PreviewTarget) => ['preview', t.projectId, t.runId ?? null] as const;

export interface PreviewState {
  /** Yang di-preview; null bila belum ada project aktif. */
  target: PreviewTarget | null;
  info: PreviewInfo | null;
  /** Memulai sedang berlangsung dari panel ini. */
  starting: boolean;
  /** Galat memulai yang bukan dari worker (mis. proses worker putus). */
  error: string | null;
  loading: boolean;
  workerConnected: boolean;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

/**
 * Keadaan preview untuk project aktif: hasil run yang sedang ditinjau (worktree-nya) bila ada, selain itu folder
 * project. Keadaan didorong worker (`preview.state`), jadi dev server yang dimulai agent juga muncul di sini.
 */
export function usePreview(): PreviewState {
  const projectId = useUiStore((s) => s.activeProjectId);
  const runId = useUiStore((s) => s.reviewRunId);
  const connected = useWorker().local === 'connected';
  const queryClient = useQueryClient();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const target: PreviewTarget | null = projectId
    ? { projectId, ...(runId ? { runId } : {}) }
    : null;
  const key = target ? keyOf(target) : null;
  const targetRef = useRef(target);
  targetRef.current = target;

  const query = useQuery({
    queryKey: target ? queryKey(target) : ['preview', null],
    queryFn: () => workerApi.previewGet(target!),
    enabled: target !== null && connected,
  });

  // Dorongan dari worker: mulai, siap, gagal, berhenti.
  useEffect(
    () =>
      localWorker.onPush((push) => {
        if (push.push !== 'preview.state') return;
        const info = push.preview;
        queryClient.setQueryData(
          queryKey({ projectId: info.projectId, ...(info.runId ? { runId: info.runId } : {}) }),
          info.status === 'stopped' ? null : info,
        );
      }),
    [queryClient],
  );

  // Panel ditutup: preview yang dimulai dari sini dihentikan setelah jeda; kembali sebelum itu membatalkannya.
  useEffect(() => {
    const snapshot = targetRef.current;
    if (!key || !snapshot) return;
    const pending = startedHere.get(key);
    if (pending) {
      clearTimeout(pending);
      startedHere.set(key, undefined);
    }
    return () => {
      if (!startedHere.has(key)) return;
      const timer = setTimeout(() => {
        startedHere.delete(key);
        void workerApi.previewStop(snapshot).catch(() => undefined);
      }, STOP_GRACE_MS);
      startedHere.set(key, timer);
    };
  }, [key]);

  const start = useCallback(async () => {
    const current = targetRef.current;
    if (!current) return;
    setError(null);
    setStarting(true);
    startedHere.set(keyOf(current), undefined);
    try {
      const info = await workerApi.previewStart(current);
      queryClient.setQueryData(queryKey(current), info);
    } catch (e) {
      setError(workerErrorMessage(e));
    } finally {
      setStarting(false);
    }
  }, [queryClient]);

  const stop = useCallback(async () => {
    const current = targetRef.current;
    if (!current) return;
    startedHere.delete(keyOf(current));
    try {
      await workerApi.previewStop(current);
    } catch (e) {
      setError(workerErrorMessage(e));
      return;
    }
    queryClient.setQueryData(queryKey(current), null);
  }, [queryClient]);

  return {
    target,
    info: query.data ?? null,
    starting,
    error,
    loading: connected && target !== null && query.isPending,
    workerConnected: connected,
    start,
    stop,
  };
}
