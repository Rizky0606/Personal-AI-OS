import type { ResearchPlanSchema } from '@aios/contracts';
import { type SQL, sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  uniqueIndex,
  customType,
} from 'drizzle-orm/pg-core';
import type { z } from 'zod';
import { uuidv7 } from '../../lib/uuidv7.js';
import { conversations, devices, messages, runs, spaces } from './core.js';
import {
  researchDepth,
  researchStatus,
  scheduleNotify,
  scheduleRunStatus,
  scheduleTarget,
} from './enums.js';

/** Kolom `tsvector` untuk full-text search; diisi Postgres sendiri (kolom generated). */
const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

/** Kolom biner Postgres (`bytea`) sebagai Buffer Node. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

/* Jadwal, riset, berkas, routing, dan audit. Bergantung pada tabel inti, tidak sebaliknya. */

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

export const schedules = pgTable('schedules', {
  id: id(),
  name: text('name').notNull(),
  cron: text('cron').notNull(),
  timezone: text('timezone').notNull().default('Asia/Jakarta'),
  prompt: text('prompt').notNull(),
  target: scheduleTarget('target').notNull(),
  agentRole: text('agent_role'),
  enabled: boolean('enabled').notNull().default(true),
  notify: scheduleNotify('notify').notNull().default('always'),
  nextRunAt: timestamp('next_run_at', { withTimezone: true }),
  conversationId: uuid('conversation_id').references(() => conversations.id, {
    onDelete: 'set null',
  }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const scheduleRuns = pgTable(
  'schedule_runs',
  {
    id: id(),
    scheduleId: uuid('schedule_id')
      .notNull()
      .references(() => schedules.id, { onDelete: 'cascade' }),
    runId: uuid('run_id').references(() => runs.id, { onDelete: 'set null' }),
    status: scheduleRunStatus('status').notNull().default('running'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    /** Jadwal on_change: false bila hasil sama dengan run sebelumnya; null bila tidak dibandingkan. */
    changed: boolean('changed'),
  },
  (t) => [
    index('schedule_runs_schedule_idx').on(t.scheduleId, t.id),
    // Singleton per jadwal: paling banyak satu run 'running', ditegakkan database.
    uniqueIndex('schedule_runs_one_running')
      .on(t.scheduleId)
      .where(sql`${t.status} = 'running'`),
  ],
);

export const researchJobs = pgTable('research_jobs', {
  id: id(),
  question: text('question').notNull(),
  depth: researchDepth('depth').notNull().default('standard'),
  status: researchStatus('status').notNull().default('queued'),
  plan: jsonb('plan').$type<z.infer<typeof ResearchPlanSchema>>(),
  reportMd: text('report_md'),
  runId: uuid('run_id').references(() => runs.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const researchSources = pgTable(
  'research_sources',
  {
    id: id(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => researchJobs.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    title: text('title').notNull().default(''),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }),
    used: boolean('used').notNull().default(false),
  },
  (t) => [index('research_sources_job_idx').on(t.jobId)],
);

export const files = pgTable('files', {
  id: id(),
  name: text('name').notNull(),
  mime: text('mime').notNull(),
  size: bigint('size', { mode: 'number' }).notNull(),
  /** Isi berkas di database (ikut backup pg_dump); tidak pernah diekspos ke klien. */
  content: bytea('content').notNull(),
  sha256: text('sha256').notNull(),
  createdAt: createdAt(),
});

export const routingDecisions = pgTable(
  'routing_decisions',
  {
    id: id(),
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    confidence: doublePrecision('confidence').notNull(),
    reason: text('reason').notNull(),
    latencyMs: integer('latency_ms').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('routing_decisions_message_idx').on(t.messageId)],
);

export const routingCorrections = pgTable('routing_corrections', {
  id: id(),
  decisionId: uuid('decision_id')
    .notNull()
    .references(() => routingDecisions.id, { onDelete: 'cascade' }),
  fromRole: text('from_role').notNull(),
  toRole: text('to_role').notNull(),
  messageExcerpt: text('message_excerpt').notNull(),
  createdAt: createdAt(),
});

export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    actorDeviceId: uuid('actor_device_id').references(() => devices.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    target: text('target').notNull().default(''),
    ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_log_ts_idx').on(t.ts)],
);

/** Memori yang terlihat (W17): fakta tentang pemilik, disuntik ke pesan sistem setiap run bila aktif. */
export const memories = pgTable(
  'memories',
  {
    id: id(),
    text: text('text').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('memories_created_idx').on(t.createdAt)],
);

/** Dokumen di ruang pengetahuan (W21): berkas dari tabel files yang teksnya sudah diindeks. */
export const spaceDocuments = pgTable(
  'space_documents',
  {
    id: id(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    chars: integer('chars').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('space_documents_space_idx').on(t.spaceId),
    uniqueIndex('space_documents_file_unique').on(t.spaceId, t.fileId),
  ],
);

/** Potongan teks dokumen ruang; dicari dengan full-text search `simple` (tanpa stemming bahasa tertentu). */
export const spaceChunks = pgTable(
  'space_chunks',
  {
    id: id(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => spaceDocuments.id, { onDelete: 'cascade' }),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    content: text('content').notNull(),
    tsv: tsvector('tsv').generatedAlwaysAs(
      (): SQL => sql`to_tsvector('simple', ${spaceChunks.content})`,
    ),
  },
  (t) => [
    index('space_chunks_space_idx').on(t.spaceId),
    index('space_chunks_tsv_idx').using('gin', t.tsv),
  ],
);
