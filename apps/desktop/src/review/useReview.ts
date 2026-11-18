import type { ReviewState } from '@aios/contracts';
import { useQuery } from '@tanstack/react-query';
import { ApiProblem } from '../auth/authSession';
import { apiErrorMessage } from '../api/errors';
import { workerApi } from '../app/services';
import { copy } from '../copy';
import { workerErrorMessage } from '../worker/errors';
import { useWorker } from '../worker/hooks';
import { WorkerCallError } from '../worker/localClient';

export const reviewKey = (runId: string) => ['review', runId] as const;

/** Diff, checkpoint, dan usulan pesan commit dari worker lokal; hanya bisa dibaca saat worker tersambung. */
export function useReviewState(runId: string) {
  const connected = useWorker().local === 'connected';
  return useQuery<ReviewState>({
    queryKey: [...reviewKey(runId), connected],
    queryFn: () => workerApi.reviewGet(runId),
    enabled: connected,
    retry: false,
  });
}

/** Aksi tinjauan; galatnya selalu menyebut aksi mana yang belum terjadi. */
export type ReviewAction = 'accept' | 'reject' | 'comments' | 'revert' | 'restore';

/**
 * Pesan untuk galat keputusan review (gateway) atau operasi worker: aksi yang belum terjadi, sebabnya, dan langkah
 * berikutnya. `worker_offline` dari gateway berarti worker yang memegang folder kerja run tidak tersambung (bukan
 * "perubahan belum bisa dibaca").
 */
export function reviewErrorMessage(error: unknown, online: boolean, action: ReviewAction): string {
  const failed = copy.review.actionFailed[action];
  if (error instanceof WorkerCallError) return `${failed} ${workerErrorMessage(error)}`;
  if (error instanceof ApiProblem) {
    if (error.code === 'run_not_reviewable') return `${failed} ${copy.review.notReviewable}`;
    if (error.code === 'review_failed') return `${failed} ${error.message}`;
    if (error.code === 'worker_offline') return `${failed} ${copy.review.holderOffline}`;
  }
  return `${failed} ${apiErrorMessage(error, online)}`;
}
