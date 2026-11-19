import type { ReviewComment, ReviewState } from '@aios/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { useOnline } from '../app/hooks';
import { api, runs, workerApi } from '../app/services';
import { copy } from '../copy';
import { useUiStore } from '../state/uiStore';
import { useToastStore } from '../ui/Toaster';
import { reviewErrorMessage, reviewKey, type ReviewAction } from './useReview';

export interface ReviewActionError {
  action: ReviewAction;
  message: string;
}

/**
 * Semua aksi tinjauan: terima, tolak, kembalikan ke agent dengan komentar (gateway), serta batalkan file dan
 * kembali ke checkpoint (worker lokal). Satu operasi pada satu waktu; keadaan panel tidak berubah bila gagal.
 * Aksi berdialog (terima, tolak, batalkan file, checkpoint) menaruh galatnya di `error` supaya tampil di dalam
 * dialog yang tetap terbuka; kirim komentar tidak punya dialog, jadi galatnya toast.
 */
export function useReviewActions(runId: string, onState: (state: ReviewState) => void) {
  const queryClient = useQueryClient();
  const online = useOnline();
  const push = useToastStore((s) => s.push);
  const setReviewRunId = useUiStore((s) => s.setReviewRunId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ReviewActionError | null>(null);

  const afterDecision = useCallback(async () => {
    setReviewRunId(null);
    await Promise.all(
      ['run', 'review', 'messages', 'conversations'].map((key) =>
        queryClient.invalidateQueries({ queryKey: [key] }),
      ),
    );
  }, [queryClient, setReviewRunId]);

  /** Menjalankan satu aksi; false bila gagal (pesan sudah ditampilkan atau ada di `error`). */
  const guarded = useCallback(
    async (action: ReviewAction, work: () => Promise<void>): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        await work();
        return true;
      } catch (cause) {
        const message = reviewErrorMessage(cause, online, action);
        if (action === 'comments') push(message, 'danger');
        else setError({ action, message });
        // Hasil yang sudah diputuskan di tempat lain: segarkan status supaya panel ikut menutup.
        void queryClient.invalidateQueries({ queryKey: ['run'] });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [push, online, queryClient],
  );

  return {
    busy,
    error,
    clearError: () => setError(null),

    accept: (options: { merge: boolean; commitMessage: string }, target: string | null) =>
      guarded('accept', async () => {
        const result = await api.reviewRun(runId, { decision: 'accept', ...options });
        const skipped = result.mergeSkipped ? copy.review.mergeSkipped[result.mergeSkipped] : null;
        push(
          result.merged
            ? copy.review.acceptedMerged(target ?? 'branch kerja')
            : result.commit === null
              ? (skipped ?? copy.review.rejected)
              : [skipped, copy.review.acceptedBranch(result.branch)].filter(Boolean).join(' '),
        );
        await afterDecision();
      }),

    reject: () =>
      guarded('reject', async () => {
        await api.reviewRun(runId, { decision: 'reject' });
        push(copy.review.rejected);
        await afterDecision();
      }),

    sendComments: (comments: ReviewComment[]) =>
      guarded('comments', async () => {
        const result = await api.reviewRun(runId, { decision: 'reject', comments });
        if (result.revisionRunId) {
          runs.track(result.revisionRunId);
          // Revisi berjalan di branch yang sama dengan run yang ditinjau.
          useUiStore.getState().setActiveRunBranch(result.branch);
        }
        push(copy.review.commentsSent);
        await afterDecision();
      }),

    revertFile: (path: string) =>
      guarded('revert', async () => {
        const next = await workerApi.reviewRevertFile(runId, path);
        queryClient.setQueryData([...reviewKey(runId), true], next);
        onState(next);
        push(copy.review.reverted);
      }),

    restore: (checkpointId: string) =>
      guarded('restore', async () => {
        const next = await workerApi.reviewUndo(runId, checkpointId);
        queryClient.setQueryData([...reviewKey(runId), true], next);
        onState(next);
        push(copy.review.checkpoints.restored);
      }),
  };
}
