import {
  ApprovalDecisionSchema,
  ApprovalKindSchema,
  ApprovalStatusSchema,
  DeviceKindSchema,
  EngineSchema,
  MessageAuthorSchema,
  ResearchDepthSchema,
  ResearchStatusSchema,
  RunKindSchema,
  RunStatusSchema,
  ScheduleNotifySchema,
  ScheduleRunStatusSchema,
  ScheduleTargetSchema,
  SurfaceSchema,
  TaskStatusSchema,
} from '@aios/contracts';
import { pgEnum } from 'drizzle-orm/pg-core';

/*
 * Nilai enum diambil dari packages/contracts supaya DB dan API tidak bisa berbeda.
 * Menambah nilai di contracts berarti membuat migrasi baru (pnpm --filter @aios/gateway db:generate).
 */
const values = <T extends string>(options: readonly T[]) => options as unknown as [T, ...T[]];

export const deviceKind = pgEnum('device_kind', values(DeviceKindSchema.options));
export const surface = pgEnum('surface', values(SurfaceSchema.options));
export const messageAuthor = pgEnum('message_author', values(MessageAuthorSchema.options));
export const runKind = pgEnum('run_kind', values(RunKindSchema.options));
export const runEngine = pgEnum('run_engine', values(EngineSchema.options));
export const runStatus = pgEnum('run_status', values(RunStatusSchema.options));
export const approvalKind = pgEnum('approval_kind', values(ApprovalKindSchema.options));
export const approvalStatus = pgEnum('approval_status', values(ApprovalStatusSchema.options));
export const approvalDecision = pgEnum('approval_decision', values(ApprovalDecisionSchema.options));
export const taskStatus = pgEnum('task_status', values(TaskStatusSchema.options));
export const scheduleTarget = pgEnum('schedule_target', values(ScheduleTargetSchema.options));
export const scheduleNotify = pgEnum('schedule_notify', values(ScheduleNotifySchema.options));
export const scheduleRunStatus = pgEnum(
  'schedule_run_status',
  values(ScheduleRunStatusSchema.options),
);
export const researchDepth = pgEnum('research_depth', values(ResearchDepthSchema.options));
export const researchStatus = pgEnum('research_status', values(ResearchStatusSchema.options));
