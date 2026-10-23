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

/** Pesan untuk galat keputusan review (gateway) atau operasi worker; selalu menyebut langkah berikutnya. */
export function reviewErrorMessage(error: unknown, online: boolean): string {
  if (error instanceof WorkerCallError) return workerErrorMessage(error);
  if (error instanceof ApiProblem) {
    if (error.code === 'run_not_reviewable') return copy.review.notReviewable;
    if (error.code === 'review_failed') return `${copy.review.failed} ${error.message}`;
    if (error.code === 'worker_offline') return copy.review.workerOffline;
  }
  return `${copy.review.failed} ${apiErrorMessage(error, online)}`;
}
