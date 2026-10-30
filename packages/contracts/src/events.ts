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

/**
 * Judul ringkas satu baris dari penalaran, bila mesin menyediakannya. Opsional: mesin yang tidak
 * mengirimnya (omp dan Hermes saat ini) tidak mengisinya; klien menurunkan judul dari teks penalaran.
 * Pembaruan menggantikan judul sebelumnya.
 */
export const ReasoningSummaryEventSchema = z.object({
  type: z.literal('reasoning.summary'),
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

export const TodoStatusSchema = z.enum([
  'pending',
  'in_progress',
  'completed',
  'abandoned',
  'blocked',
]);
export type TodoStatus = z.infer<typeof TodoStatusSchema>;

export const TODO_MAX_PHASES = 12;
export const TODO_MAX_TASKS = 30;

export const TodoTaskSchema = z.object({
  content: z.string().max(200),
  status: TodoStatusSchema,
  blocker: z.string().max(200).optional(),
});
export const TodoPhaseSchema = z.object({
  name: z.string().max(80),
  tasks: z.array(TodoTaskSchema).max(TODO_MAX_TASKS),
});
export type TodoPhase = z.infer<typeof TodoPhaseSchema>;

/** Daftar rencana agent (tool `todo` omp) setelah tiap perubahan; selalu seluruh daftar, bukan selisih. */
export const TodoUpdatedEventSchema = z.object({
  type: z.literal('todo.updated'),
  phases: z.array(TodoPhaseSchema).max(TODO_MAX_PHASES),
});

export const QueueNameSchema = z.enum(['steering', 'followUp']);
export type QueueName = z.infer<typeof QueueNameSchema>;

/** Pesan arahan yang menunggu giliran di agent: `steering` disisipkan setelah tool berjalan, `followUp` setelah agent selesai. */
export const QueueUpdatedEventSchema = z.object({
  type: z.literal('queue.updated'),
  steering: z.array(z.string().max(500)).max(20),
  followUp: z.array(z.string().max(500)).max(20),
});

/** Keadaan satu subagent omp (tool `task`). `running` mencakup menunggu dan berjalan; sisanya final. */
export const SubagentStatusSchema = z.enum(['running', 'completed', 'failed', 'aborted']);
export type SubagentStatus = z.infer<typeof SubagentStatusSchema>;

/** Pembaruan satu subagent; selalu seluruh keadaannya, bukan selisih. Dikirim saat status atau jumlah tool berubah. */
export const SubagentUpdatedEventSchema = z.object({
  type: z.literal('subagent.updated'),
  subagentId: z.string().min(1).max(80),
  agent: z.string().max(80),
  assignment: z.string().max(300),
  status: SubagentStatusSchema,
  toolCount: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  tokens: z.number().int().nonnegative(),
  /** Baris terakhir keluaran subagent, dipangkas. */
  lastOutput: z.string().max(300).optional(),
  /** ID panggilan tool `task` milik agent induk yang memulainya. */
  parentToolCallId: z.string().max(200).optional(),
});

/** Satu pertanyaan agent (tool `ask` omp). Pilihan "Lainnya" tidak ada di `options`: klien selalu menyediakan teks bebas. */
export const QuestionSchema = z.object({
  id: z.string().min(1).max(80),
  question: z.string().max(1000),
  header: z.string().max(100).optional(),
  options: z
    .array(
      z.object({
        label: z.string().max(200),
        description: z.string().max(500).optional(),
      }),
    )
    .max(12),
  multi: z.boolean().optional(),
  recommended: z.number().int().nonnegative().optional(),
});
export type Question = z.infer<typeof QuestionSchema>;

export const QuestionAnswerSchema = z.object({
  id: z.string().min(1).max(80),
  selectedOptions: z.array(z.string().max(200)).max(12),
  customInput: z.string().max(2000).optional(),
});
export type QuestionAnswer = z.infer<typeof QuestionAnswerSchema>;

/** Agent bertanya ke pengguna dan menunggu jawaban; run tetap `running` sampai `question.resolved`. */
export const QuestionAskedEventSchema = z.object({
  type: z.literal('question.asked'),
  questionId: IdSchema,
  questions: z.array(QuestionSchema).min(1).max(8),
});

/** Pertanyaan selesai: dijawab atau dibatalkan (pengguna, run dihentikan, atau batas waktu). */
export const QuestionResolvedEventSchema = z.object({
  type: z.literal('question.resolved'),
  questionId: IdSchema,
  cancelled: z.boolean(),
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

export const ArtifactCreatedEventSchema = z.object({
  type: z.literal('artifact.created'),
  fileId: IdSchema,
  name: z.string().min(1).max(200),
  mime: z.string().min(1).max(255),
  size: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  source: z.enum(['screenshot', 'file']),
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
    ReasoningSummaryEventSchema,
    ToolStartedEventSchema,
    ToolOutputEventSchema,
    ToolFinishedEventSchema,
    ApprovalRequestedEventSchema,
    ApprovalResolvedEventSchema,
    DiffUpdatedEventSchema,
    CheckpointCreatedEventSchema,
    TodoUpdatedEventSchema,
    QueueUpdatedEventSchema,
    SubagentUpdatedEventSchema,
    QuestionAskedEventSchema,
    QuestionResolvedEventSchema,
    PreviewReadyEventSchema,
    ResearchProgressEventSchema,
    ResearchSourceEventSchema,
    ErrorEventSchema,
    ArtifactCreatedEventSchema,
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

export const TeamStatusSchema = z.enum([
  'queued',
  'planning',
  'running',
  'reviewing',
  'completed',
  'failed',
  'cancelled',
  'needs_attention',
]);
export const TeamMemberRoleSchema = z.enum(['lead', 'worker']);
export const TeamMemberStatusSchema = z.enum([
  'queued',
  'running',
  'reviewing',
  'completed',
  'failed',
  'cancelled',
  'needs_attention',
]);

export const TeamCreatedEventSchema = z.object({
  type: z.literal('team.created'),
  teamId: IdSchema,
  status: TeamStatusSchema,
  createdAt: TimestampSchema,
});

export const TeamMemberUpdatedEventSchema = z.object({
  type: z.literal('team.member.updated'),
  teamId: IdSchema,
  member: z
    .object({
      id: IdSchema,
      role: TeamMemberRoleSchema,
      status: TeamMemberStatusSchema,
      updatedAt: TimestampSchema,
    })
    .strict(),
});

export const TeamReviewCompletedEventSchema = z.object({
  type: z.literal('team.review.completed'),
  teamId: IdSchema,
  memberId: IdSchema,
  decision: z.enum(['accept', 'revise', 'reject']),
  completedAt: TimestampSchema,
});

export const TeamEventSchema = z
  .discriminatedUnion('type', [
    TeamCreatedEventSchema,
    TeamMemberUpdatedEventSchema,
    TeamReviewCompletedEventSchema,
  ])
  .meta({ id: 'TeamEvent' });
export type TeamEvent = z.infer<typeof TeamEventSchema>;


/** Semua event yang bisa ada di envelope WebSocket. */
export const ServerEventSchema = z
  .union([AgentEventSchema, UserEventSchema, TeamEventSchema])
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
