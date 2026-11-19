import {
  TERMINAL_RUN_STATUSES,
  type RunEndReason,
  type RunStatus,
  type WorkspaceRunListSchema,
} from '@aios/contracts';
import type { z } from 'zod';
import { copy } from '../copy';

export type WorkspaceRun = z.infer<typeof WorkspaceRunListSchema>['items'][number];

/**
 * Label status run di daftar. `endReason` dari gateway membedakan run yang dihentikan pemilik tetapi sudah mengubah
 * berkas (`needs_review`) dan run yang digantikan run lanjutan (`rejected`) dari tinjauan dan penolakan biasa.
 */
export function runStatusLabel(run: { status: RunStatus; endReason: RunEndReason | null }): string {
  if (run.status === 'needs_review' && run.endReason === 'stopped') {
    return copy.workspace.stoppedReview;
  }
  if (run.status === 'rejected' && run.endReason === 'superseded') {
    return copy.workspace.superseded;
  }
  return copy.runStatus[run.status];
}

export type RunFilter = 'all' | 'active' | 'review' | 'done';

export const RUN_FILTERS: RunFilter[] = ['all', 'active', 'review', 'done'];

/** Run belum final: masih berjalan, menunggu izin, atau menunggu tinjauan hasil. */
export const isLiveRun = (status: RunStatus) => !TERMINAL_RUN_STATUSES.includes(status);

/** Perlu perhatian pemilik: izin atau tinjauan hasil. */
export const needsAttention = (status: RunStatus) =>
  status === 'waiting_approval' || status === 'needs_review';

/** Run yang masih bisa dihentikan (belum menunggu tinjauan, belum final). */
export const isCancellable = (status: RunStatus) => isLiveRun(status) && status !== 'needs_review';

export function filterRuns(items: WorkspaceRun[], filter: RunFilter): WorkspaceRun[] {
  switch (filter) {
    case 'active':
      return items.filter((i) => isLiveRun(i.run.status) && i.run.status !== 'needs_review');
    case 'review':
      return items.filter((i) => i.run.status === 'needs_review');
    case 'done':
      return items.filter((i) => !isLiveRun(i.run.status));
    default:
      return items;
  }
}

export function countRuns(items: WorkspaceRun[]): Record<RunFilter, number> {
  return {
    all: items.length,
    active: filterRuns(items, 'active').length,
    review: filterRuns(items, 'review').length,
    done: filterRuns(items, 'done').length,
  };
}

/** Warna penanda status dari token: aksen untuk berjalan, peringatan untuk perlu tindakan. */
export function statusDotClass(status: RunStatus): string {
  if (status === 'failed') return 'bg-danger';
  if (needsAttention(status)) return 'bg-warning';
  if (isLiveRun(status)) return 'animate-aios-breathe bg-accent';
  if (status === 'cancelled' || status === 'rejected') return 'bg-border-strong';
  return 'bg-success';
}
