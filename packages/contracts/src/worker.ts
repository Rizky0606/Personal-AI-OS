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
