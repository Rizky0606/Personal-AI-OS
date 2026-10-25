import { z } from 'zod';
import { IdSchema, RoleIdSchema, RunErrorSchema, TimestampSchema, UsageSchema } from './common.js';
import {
  ApprovalDecisionSchema,
  ApprovalKindSchema,
  ScheduleRunStatusSchema,
  TaskSchema,
} from './entities.js';
import { RunStatusSchema } from './run-status.js';

/* Event run dan percakapan (API_CONTRACT.md, "Tipe AgentEvent"). */

export const RunStatusEventSchema = z.object({
  type: z.literal('run.status'),
  status: RunStatusSchema,
});

export const RouteDecidedEventSchema = z.object({
  type: z.literal('route.decided'),
  role: RoleIdSchema,
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});

export const MessageDeltaEventSchema = z.object({
  type: z.literal('message.delta'),
  messageId: IdSchema,
  text: z.string(),
});

export const MessageCompletedEventSchema = z.object({
  type: z.literal('message.completed'),
  messageId: IdSchema,
  usage: UsageSchema.optional(),
});

export const ReasoningDeltaEventSchema = z.object({
  type: z.literal('reasoning.delta'),
  messageId: IdSchema,
  text: z.string(),
});

export const ToolStartedEventSchema = z.object({
  type: z.literal('tool.started'),
  toolCallId: z.string().min(1),
  name: z.string().min(1),
  target: z.string().optional(),
});

export const ToolOutputEventSchema = z.object({
  type: z.literal('tool.output'),
  toolCallId: z.string().min(1),
  chunk: z.string(),
  stream: z.enum(['stdout', 'stderr']).optional(),
});

export const ToolFinishedEventSchema = z.object({
  type: z.literal('tool.finished'),
  toolCallId: z.string().min(1),
  status: z.enum(['ok', 'error', 'denied', 'cancelled']),
  durationMs: z.number().int().nonnegative(),
});

export const ApprovalRequestedEventSchema = z.object({
  type: z.literal('approval.requested'),
  approvalId: IdSchema,
  kind: ApprovalKindSchema,
  detail: z.string(),
  cwd: z.string().optional(),
  toolCallId: z.string().min(1).optional(),
});

export const ApprovalResolvedEventSchema = z.object({
  type: z.literal('approval.resolved'),
  approvalId: IdSchema,
  decision: ApprovalDecisionSchema,
  remember: z.boolean(),
});

export const DiffFileSchema = z.object({
  path: z.string().min(1),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
});

export const DiffUpdatedEventSchema = z.object({
  type: z.literal('diff.updated'),
  files: z.array(DiffFileSchema),
});

export const CheckpointCreatedEventSchema = z.object({
  type: z.literal('checkpoint.created'),
  checkpointId: z.string().min(1),
  label: z.string(),
});

export const PreviewReadyEventSchema = z.object({
  type: z.literal('preview.ready'),
  url: z.url(),
});

export const ResearchStageSchema = z.enum(['planning', 'searching', 'reading', 'writing']);
export type ResearchStage = z.infer<typeof ResearchStageSchema>;

export const ResearchProgressEventSchema = z.object({
  type: z.literal('research.progress'),
  stage: ResearchStageSchema,
  progress: z.number().min(0).max(1),
  message: z.string().optional(),
});

export const ResearchSourceEventSchema = z.object({
  type: z.literal('research.source'),
  sourceId: IdSchema,
  url: z.url(),
  title: z.string(),
});

export const ErrorEventSchema = z.object({
  type: z.literal('error'),
  ...RunErrorSchema.shape,
});

export const RunCompletedEventSchema = z.object({
  type: z.literal('run.completed'),
  summary: z.string(),
  usage: UsageSchema.optional(),
});

export const AgentEventSchema = z
  .discriminatedUnion('type', [
    RunStatusEventSchema,
    RouteDecidedEventSchema,
    MessageDeltaEventSchema,
    MessageCompletedEventSchema,
    ReasoningDeltaEventSchema,
    ToolStartedEventSchema,
    ToolOutputEventSchema,
    ToolFinishedEventSchema,
    ApprovalRequestedEventSchema,
    ApprovalResolvedEventSchema,
    DiffUpdatedEventSchema,
    CheckpointCreatedEventSchema,
    PreviewReadyEventSchema,
    ResearchProgressEventSchema,
    ResearchSourceEventSchema,
    ErrorEventSchema,
    RunCompletedEventSchema,
  ])
  .meta({ id: 'AgentEvent' });
export type AgentEvent = z.infer<typeof AgentEventSchema>;
export type AgentEventType = AgentEvent['type'];

/* Event channel `user`. */

export const TaskUpdatedEventSchema = z.object({
  type: z.literal('task.updated'),
  task: TaskSchema,
});

export const ScheduleResultEventSchema = z.object({
  type: z.literal('schedule.result'),
  scheduleId: IdSchema,
  scheduleRunId: IdSchema,
  runId: IdSchema.nullable(),
  status: ScheduleRunStatusSchema,
  /** Jadwal `on_change`: false = hasil sama dengan sebelumnya, tanpa notifikasi. */
  changed: z.boolean().nullable().optional(),
});

export const ResearchCompletedEventSchema = z.object({
  type: z.literal('research.completed'),
  researchId: IdSchema,
  runId: IdSchema.nullable(),
});

export const NotificationEventSchema = z.object({
  type: z.literal('notification'),
  title: z.string().min(1),
  body: z.string().optional(),
  level: z.enum(['info', 'warning', 'error']),
});

export const UserEventSchema = z
  .discriminatedUnion('type', [
    TaskUpdatedEventSchema,
    ScheduleResultEventSchema,
    ResearchCompletedEventSchema,
    NotificationEventSchema,
  ])
  .meta({ id: 'UserEvent' });
export type UserEvent = z.infer<typeof UserEventSchema>;

/** Semua event yang bisa ada di envelope WebSocket. */
export const ServerEventSchema = z
  .union([AgentEventSchema, UserEventSchema])
  .meta({ id: 'ServerEvent' });
export type ServerEvent = z.infer<typeof ServerEventSchema>;

/** Baris `run_events`: event yang disimpan per run dengan nomor urut. */
export const RunEventSchema = z
  .object({
    runId: IdSchema,
    seq: z.number().int().positive(),
    ts: TimestampSchema,
    event: AgentEventSchema,
  })
  .meta({ id: 'RunEvent' });
export type RunEvent = z.infer<typeof RunEventSchema>;
