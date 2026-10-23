import { z } from 'zod';

export const RunStatusSchema = z
  .enum([
    'queued',
    'routing',
    'preparing',
    'running',
    'waiting_approval',
    'needs_review',
    'accepted',
    'rejected',
    'completed',
    'failed',
    'cancelled',
  ])
  .meta({ id: 'RunStatus' });
export type RunStatus = z.infer<typeof RunStatusSchema>;

/** Diagram status run di API_CONTRACT.md. Semua run bisa berakhir failed atau cancelled. */
export const RUN_STATUS_TRANSITIONS: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  queued: ['routing', 'failed', 'cancelled'],
  routing: ['preparing', 'failed', 'cancelled'],
  preparing: ['running', 'failed', 'cancelled'],
  running: ['waiting_approval', 'needs_review', 'completed', 'failed', 'cancelled'],
  waiting_approval: ['running', 'failed', 'cancelled'],
  needs_review: ['accepted', 'rejected', 'failed', 'cancelled'],
  accepted: [],
  rejected: [],
  completed: [],
  failed: [],
  cancelled: [],
};

export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = [
  'accepted',
  'rejected',
  'completed',
  'failed',
  'cancelled',
];

export function canTransition(from: RunStatus, to: RunStatus): boolean {
  return RUN_STATUS_TRANSITIONS[from].includes(to);
}
