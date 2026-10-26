import type { AgentEvent, DiffStat, MessagePart, RunError, Stack, Usage } from '@aios/contracts';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { uuidv7 } from '../../lib/uuidv7.js';
import {
  approvalDecision,
  approvalKind,
  approvalStatus,
  deviceKind,
  messageAuthor,
  runEngine,
  runKind,
  runStatus,
  surface,
  taskStatus,
} from './enums.js';

/*
 * Tabel inti (API_CONTRACT.md, "Model data inti"). Nama kolom snake_case di DB, camelCase di kode
 * sehingga cocok dengan field di packages/contracts. runs, tasks, conversations, dan messages
 * saling merujuk, jadi tinggal di satu file.
 */

const id = () =>
  uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7());
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const devices = pgTable('devices', {
  id: id(),
  kind: deviceKind('kind').notNull(),
  name: text('name').notNull(),
  /** SHA-256 token refresh saat ini; token mentah tidak pernah disimpan. */
  tokenHash: text('token_hash').notNull(),
  /** Refresh token berlaku 90 hari sejak rotasi terakhir. */
  refreshExpiresAt: timestamp('refresh_expires_at', { withTimezone: true }).notNull().defaultNow(),
  /** Perangkat dicabut (logout, dihapus pemilik, atau pemakaian ulang refresh token). */
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  scopes: text('scopes')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  pushToken: text('push_token'),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  createdAt: createdAt(),
});

export const projects = pgTable('projects', {
  id: id(),
  name: text('name').notNull(),
  workerDeviceId: uuid('worker_device_id')
    .notNull()
    .references(() => devices.id),
  stack: jsonb('stack').$type<Stack>().notNull(),
  defaultBranch: text('default_branch').notNull().default('main'),
  /** Aturan project (W23), disuntik ke pesan sistem setiap run di project ini. */
  instructions: text('instructions').notNull().default(''),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Ruang pengetahuan (W21). Dokumen dan potongannya ada di extra.ts; di sini karena conversations merujuknya. */
export const spaces = pgTable('spaces', {
  id: id(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const conversations = pgTable(
  'conversations',
  {
    id: id(),
    title: text('title').notNull().default(''),
    surface: surface('surface').notNull(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    spaceId: uuid('space_id').references(() => spaces.id, { onDelete: 'set null' }),
    hermesSessionId: text('hermes_session_id'),
    pinned: boolean('pinned').notNull().default(false),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('conversations_project_idx').on(t.projectId),
    index('conversations_space_idx').on(t.spaceId),
  ],
);

export const tasks = pgTable(
  'tasks',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    status: taskStatus('status').notNull().default('backlog'),
    position: integer('position').notNull().default(0),
    agentRole: text('agent_role'),
    runId: uuid('run_id').references((): AnyPgColumn => runs.id, { onDelete: 'set null' }),
    branch: text('branch'),
    diffStat: jsonb('diff_stat').$type<DiffStat>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('tasks_board_idx').on(t.projectId, t.status, t.position)],
);

export const runs = pgTable(
  'runs',
  {
    id: id(),
    kind: runKind('kind').notNull(),
    engine: runEngine('engine').notNull(),
    agentRole: text('agent_role'),
    model: text('model'),
    status: runStatus('status').notNull().default('queued'),
    conversationId: uuid('conversation_id').references(() => conversations.id, {
      onDelete: 'set null',
    }),
    taskId: uuid('task_id').references((): AnyPgColumn => tasks.id, { onDelete: 'set null' }),
    branch: text('branch'),
    usage: jsonb('usage').$type<Usage>(),
    error: jsonb('error').$type<RunError>(),
    /** Mode rencana (W29): run coding yang hanya membaca dan menulis rencana. */
    planOnly: boolean('plan_only').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('runs_conversation_idx').on(t.conversationId),
    index('runs_status_idx').on(t.status),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: id(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    author: messageAuthor('author').notNull(),
    parts: jsonb('parts').$type<MessagePart[]>().notNull(),
    agentRole: text('agent_role'),
    model: text('model'),
    runId: uuid('run_id').references(() => runs.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  // Pagination kursor ?before=<id> mengurutkan menurut id (UUIDv7 = urutan waktu).
  (t) => [index('messages_conversation_idx').on(t.conversationId, t.id)],
);

export const runEvents = pgTable(
  'run_events',
  {
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    /** Nomor urut per run, mulai dari 1. */
    seq: integer('seq').notNull(),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<AgentEvent>().notNull(),
    ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.seq] })],
);

export const approvals = pgTable(
  'approvals',
  {
    id: id(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    kind: approvalKind('kind').notNull(),
    detail: text('detail').notNull(),
    status: approvalStatus('status').notNull().default('pending'),
    remember: boolean('remember').notNull().default(false),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('approvals_run_idx').on(t.runId)],
);

export const approvalRules = pgTable(
  'approval_rules',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    pattern: text('pattern').notNull(),
    decision: approvalDecision('decision').notNull(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.pattern] })],
);
