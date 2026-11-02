import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { apiErrorMessage } from '../api/errors';
import { useConversationProgress } from '../api/queries';
import { useFinishedRun, useLiveRun, useOnline } from '../app/hooks';
import { useNow } from '../app/useNow';
import { buildActivity, type ActivityPhase } from '../realtime/activity';
import { buildProgress, type ProgressView } from '../realtime/progress';
import { isSettled } from '../realtime/liveRun';
import { useUiStore } from '../state/uiStore';

export interface ProgressViewState {
  /** Ada chat yang terbuka sebagai sumber data (percakapan sudah punya id). */
  hasSource: boolean;
  view: ProgressView;
  /** Fase run terbaru (untuk warna titik langkah aktif); null tanpa run. */
  phase: ActivityPhase | null;
  /** Pemuatan pertama agregat tersimpan; run live tetap bisa mengisi view saat ini. */
  loading: boolean;
  error: boolean;
  /** Pesan galat pemuatan agregat (kosong bila tidak ada galat). */
  errorMessage: string;
  /** Offline: yang tampil adalah data terakhir. */
  offline: boolean;
  refetch: () => void;
}

/**
 * Data panel Progres dan chip topbar: agregat tersimpan dari gateway digabung dengan run yang sedang mengalir
 * (`buildProgress`). Agregat diambil ulang setiap run selesai supaya hasil kerja dan rencana akhir tersimpan ikut.
 */
export function useProgressView(): ProgressViewState {
  const source = useUiStore((s) => s.progressSource);
  const online = useOnline();
  const now = useNow();
  const queryClient = useQueryClient();
  const runId = source?.runId ?? null;
  const live = useLiveRun(runId);
  const finished = useFinishedRun(runId);
  const run = live ?? finished;
  const query = useConversationProgress(source?.conversationId);

  const settled = run !== undefined && isSettled(run.status);
  const conversationId = source?.conversationId;
  useEffect(() => {
    if (settled && conversationId)
      void queryClient.invalidateQueries({ queryKey: ['progress', conversationId] });
  }, [settled, runId, conversationId, queryClient]);

  const savedTools = source?.savedTools;
  const view = useMemo(
    () => buildProgress(query.data, run, now, savedTools ? { savedTools } : {}),
    [query.data, run, now, savedTools],
  );

  const phase = useMemo(() => (run ? buildActivity(run, now).phase : null), [run, now]);

  return {
    hasSource: source !== null,
    view,
    phase,
    loading: query.isPending && source !== null,
    error: query.isError && query.data === undefined,
    errorMessage: query.isError ? apiErrorMessage(query.error, online) : '',
    offline: !online,
    refetch: () => void query.refetch(),
  };
}
