import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { api } from '../app/services';
import type { LiveRun } from '../realtime/liveRun';
import { useUiStore } from '../state/uiStore';

/**
 * Run coding terakhir di percakapan ini yang hasilnya menunggu tinjauan (`needs_review`). Mengisi tab Diff di
 * panel kanan; saat run baru saja selesai di depan mata, panel dibuka otomatis. Mengembalikan id run itu atau
 * undefined.
 */
export function useReviewTarget(runId: string | undefined, live: LiveRun | undefined) {
  const openReview = useUiStore((s) => s.openReview);
  const setReviewRunId = useUiStore((s) => s.setReviewRunId);

  const run = useQuery({
    queryKey: ['run', runId],
    queryFn: () => api.getRun(runId!),
    enabled: runId !== undefined,
    retry: false,
  });
  // Selama run hidup, status dari event lebih baru daripada hasil query terakhir.
  const status = live?.status ?? run.data?.status;
  const reviewable = runId !== undefined && status === 'needs_review';

  const wasLiveReviewable = useRef(false);
  const liveReviewable = live?.status === 'needs_review';
  useEffect(() => {
    if (!runId) return;
    if (reviewable) {
      // Baru saja selesai (kita yang menontonnya): buka panelnya. Dibuka dari riwayat: cukup siapkan isinya.
      if (liveReviewable && !wasLiveReviewable.current) openReview(runId);
      else if (useUiStore.getState().reviewRunId !== runId) setReviewRunId(runId);
    } else if (useUiStore.getState().reviewRunId === runId) {
      setReviewRunId(null);
    }
    wasLiveReviewable.current = liveReviewable;
  }, [runId, reviewable, liveReviewable, openReview, setReviewRunId]);

  // Meninggalkan percakapan: tab Diff tidak boleh menampilkan hasil percakapan lain.
  useEffect(
    () => () => {
      if (runId && useUiStore.getState().reviewRunId === runId) setReviewRunId(null);
    },
    [runId, setReviewRunId],
  );

  return reviewable ? runId : undefined;
}
