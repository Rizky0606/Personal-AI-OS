import { z } from 'zod';
import { IdSchema, RoleIdSchema } from './common.js';
import { ApprovalDecisionSchema } from './entities.js';
import { AgentEventSchema } from './events.js';

/*
 * Protokol worker (API_CONTRACT.md, "Protokol worker"): WebSocket keluar dari worker
 * ke gateway dengan token ber-scope `worker`.
 */

export const ReviewCommentSchema = z.object({
  path: z.string().min(1),
  line: z.number().int().positive(),
  body: z.string().min(1),
});
export type ReviewComment = z.infer<typeof ReviewCommentSchema>;

export const RunStartCommandSchema = z.object({
  type: z.literal('run.start'),
  runId: IdSchema,
  projectId: IdSchema,
  prompt: z.string().min(1),
  /** Bundel role dan skill yang sudah dirakit gateway menjadi satu system prompt. */
  bundle: z.object({ role: RoleIdSchema, systemPrompt: z.string() }),
  model: z.string().min(1),
  /** Lanjutan dari run sebelumnya (revisi setelah komentar review): memakai worktree run itu. */
  continueFromRunId: IdSchema.optional(),
  /** Mode rencana: semua permintaan izin (tulis, perintah, jaringan) ditolak worker. */
  planOnly: z.boolean().optional(),
});

export const RunSteerCommandSchema = z.object({
  type: z.literal('run.steer'),
  runId: IdSchema,
  text: z.string().min(1),
});

export const RunCancelCommandSchema = z.object({
  type: z.literal('run.cancel'),
  runId: IdSchema,
});

export const ApprovalResolveCommandSchema = z.object({
  type: z.literal('approval.resolve'),
  runId: IdSchema,
  approvalId: IdSchema,
  decision: ApprovalDecisionSchema,
  remember: z.boolean(),
});

export const ReviewApplyCommandSchema = z.object({
  type: z.literal('review.apply'),
  runId: IdSchema,
  decision: z.enum(['accept', 'reject']),
  comments: z.array(ReviewCommentSchema),
  merge: z.boolean().default(false),
  commitMessage: z.string().min(1).max(200).optional(),
});

/** Perintah gateway ke worker. */
export const WorkerCommandSchema = z
  .discriminatedUnion('type', [
    RunStartCommandSchema,
    RunSteerCommandSchema,
    RunCancelCommandSchema,
    ApprovalResolveCommandSchema,
    ReviewApplyCommandSchema,
  ])
  .meta({ id: 'WorkerCommand' });
export type WorkerCommand = z.infer<typeof WorkerCommandSchema>;

/** Worker ke gateway: AgentEvent untuk channel `run:<runId>`; gateway menyimpan lalu menyiarkan. */
export const WorkerEventFrameSchema = z
  .object({
    type: z.literal('run.event'),
    runId: IdSchema,
    event: AgentEventSchema,
  })
  .meta({ id: 'WorkerEventFrame' });
export type WorkerEventFrame = z.infer<typeof WorkerEventFrameSchema>;

/** Path WebSocket worker di gateway (di bawah /v1). Handshake memakai header Authorization, scope `worker`. */
export const WORKER_WS_PATH = '/worker/ws';

export const WorkerPingFrameSchema = z.object({ type: z.literal('ping') });

/** Alasan merge ke branch kerja dilewati; branch agent tetap ada. */
export const MergeSkippedSchema = z.enum([
  'dirty',
  'detached',
  'not_fast_forward',
  'nothing_to_merge',
]);
export type MergeSkipped = z.infer<typeof MergeSkippedSchema>;

/** Hasil `review.apply` dari worker (satu per perintah). */
export const WorkerReviewResultFrameSchema = z.object({
  type: z.literal('review.result'),
  runId: IdSchema,
  decision: z.enum(['accept', 'reject']),
  ok: z.boolean(),
  branch: z.string(),
  commit: z.string().nullable(),
  merged: z.boolean(),
  mergeSkipped: MergeSkippedSchema.nullable(),
  error: z.string().optional(),
});
export type WorkerReviewResultFrame = z.infer<typeof WorkerReviewResultFrameSchema>;

/** Worker ke gateway. */
export const WorkerToGatewayFrameSchema = z
  .discriminatedUnion('type', [
    WorkerEventFrameSchema,
    WorkerPingFrameSchema,
    WorkerReviewResultFrameSchema,
  ])
  .meta({ id: 'WorkerToGatewayFrame' });
export type WorkerToGatewayFrame = z.infer<typeof WorkerToGatewayFrameSchema>;

export const WorkerReadyFrameSchema = z.object({ type: z.literal('ready'), deviceId: IdSchema });
export const WorkerPongFrameSchema = z.object({ type: z.literal('pong') });
export const WorkerErrorFrameSchema = z.object({
  type: z.literal('error'),
  code: z.enum(['invalid_message', 'run_not_owned', 'run_not_active', 'replaced']),
  message: z.string(),
  runId: IdSchema.optional(),
});

/** Gateway ke worker: perintah, atau kontrol koneksi. */
export const GatewayToWorkerFrameSchema = z
  .union([
    WorkerCommandSchema,
    WorkerReadyFrameSchema,
    WorkerPongFrameSchema,
    WorkerErrorFrameSchema,
  ])
  .meta({ id: 'GatewayToWorkerFrame' });
export type GatewayToWorkerFrame = z.infer<typeof GatewayToWorkerFrameSchema>;

/** Awalan nama branch kerja agent di worktree (ARCHITECTURE.md, "Alur utama: run coding"). */
export const WORKER_BRANCH_PREFIX = 'aios/';

/**
 * Nama branch kerja satu run: `aios/<8 hex terakhir ID run>`. Bagian akhir UUIDv7 acak (bagian awalnya
 * cap waktu), jadi pendek tetapi tetap unik. Gateway dan worker menghitungnya dengan fungsi yang sama.
 */
export function workerBranchFor(runId: string): string {
  return `${WORKER_BRANCH_PREFIX}${runId.replaceAll('-', '').slice(-8)}`;
}
