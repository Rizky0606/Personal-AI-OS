import {
  ApprovalRuleSchema,
  ApprovalSchema,
  AuditLogSchema,
  ConversationSchema,
  DeviceSchema,
  FileRecordSchema,
  IdSchema,
  MessageSchema,
  ProjectSchema,
  ResearchJobSchema,
  ResearchSourceSchema,
  RoutingCorrectionSchema,
  RoutingDecisionSchema,
  RunSchema,
  RunStatusSchema,
  ScheduleRunSchema,
  ScheduleSchema,
  TaskSchema,
} from '@aios/contracts';
import { eq, getTableColumns, getTableName, is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { z } from 'zod';
import { uuidv7 } from '../lib/uuidv7.js';
import { createTestDatabase, type TestDatabase } from '../testing/db.js';
import { runMigrations } from './migrate.js';
import * as schema from './schema/index.js';

const tables = Object.values(schema).filter((v) => is(v, PgTable)) as unknown as PgTable[];

/** Tabel "Model data inti" di API_CONTRACT.md. */
const DOCUMENTED_TABLES = [
  'devices',
  'conversations',
  'messages',
  'runs',
  'run_events',
  'approvals',
  'approval_rules',
  'projects',
  'tasks',
  'schedules',
  'schedule_runs',
  'research_jobs',
  'research_sources',
  'files',
  'routing_decisions',
  'routing_corrections',
  'audit_log',
  'memories',
  'spaces',
  'space_documents',
  'space_chunks',
];

describe('skema Drizzle', () => {
  /** Tabel internal gateway yang tidak ada di "Model data inti" karena tidak diekspos lewat API. */
  const INTERNAL_TABLES = ['owner_account'];

  it('memuat 21 tabel "Model data inti" ditambah tabel internal yang disebut eksplisit', () => {
    expect(tables.map((t) => getTableName(t)).sort()).toEqual(
      [...DOCUMENTED_TABLES, ...INTERNAL_TABLES].sort(),
    );
  });

  /**
   * Setiap entitas contracts harus punya kolom padanan. Kolom DB yang tidak ada di contracts
   * harus disebut di `internal` (sengaja tidak diekspos) supaya tidak ada kolom yang lolos tanpa keputusan.
   */
  const mappings: [string, PgTable, z.ZodObject, string[]][] = [
    [
      'Device',
      schema.devices,
      DeviceSchema,
      ['tokenHash', 'pushToken', 'refreshExpiresAt', 'revokedAt'],
    ],
    ['Conversation', schema.conversations, ConversationSchema, ['hermesSessionId']],
    ['Message', schema.messages, MessageSchema, []],
    ['Run', schema.runs, RunSchema, []],
    ['Approval', schema.approvals, ApprovalSchema, ['createdAt']],
    ['ApprovalRule', schema.approvalRules, ApprovalRuleSchema, []],
    ['Project', schema.projects, ProjectSchema, []],
    ['Task', schema.tasks, TaskSchema, []],
    ['Schedule', schema.schedules, ScheduleSchema, []],
    ['ScheduleRun', schema.scheduleRuns, ScheduleRunSchema, []],
    ['ResearchJob', schema.researchJobs, ResearchJobSchema, []],
    ['ResearchSource', schema.researchSources, ResearchSourceSchema, []],
    ['FileRecord', schema.files, FileRecordSchema, ['content']],
    ['RoutingDecision', schema.routingDecisions, RoutingDecisionSchema, []],
    ['RoutingCorrection', schema.routingCorrections, RoutingCorrectionSchema, []],
    ['AuditLog', schema.auditLog, AuditLogSchema, []],
  ];

  it.each(mappings)(
    '%s: kolom tabel sama dengan field contracts',
    (_name, table, entity, internal) => {
      const columns = Object.keys(getTableColumns(table));
      const fields = Object.keys(entity.shape);
      expect(columns.filter((c) => !fields.includes(c) && !internal.includes(c))).toEqual([]);
      expect(fields.filter((f) => !columns.includes(f))).toEqual([]);
      expect(internal.filter((c) => !columns.includes(c))).toEqual([]);
    },
  );

  it('run_events menyimpan runId, seq, type, payload, dan ts', () => {
    expect(Object.keys(getTableColumns(schema.runEvents)).sort()).toEqual(
      ['payload', 'runId', 'seq', 'ts', 'type'].sort(),
    );
  });

  it('enum DB sama dengan enum contracts', () => {
    expect(getTableColumns(schema.runs).status.enumValues).toEqual(RunStatusSchema.options);
    expect(schema.runStatus.enumValues).toEqual(RunStatusSchema.options);
  });

  it('ID dibuat aplikasi sebagai UUIDv7 yang lolos contracts', () => {
    const generated = getTableColumns(schema.runs).id.defaultFn?.();
    expect(IdSchema.safeParse(generated).success).toBe(true);
    expect(IdSchema.safeParse(uuidv7()).success).toBe(true);
  });
});

describe('migrasi', () => {
  let database: TestDatabase;
  beforeAll(async () => {
    database = await createTestDatabase(inject('testDatabaseUrl'));
  });
  afterAll(async () => {
    await database.drop();
  });

  it('membuat semua tabel dan kolom yang ada di skema (migrasi tidak ketinggalan)', async () => {
    const { rows } = await database.handle.pool.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns where table_schema = 'public'`,
    );
    const actual = new Map<string, string[]>();
    for (const r of rows)
      actual.set(r.table_name, [...(actual.get(r.table_name) ?? []), r.column_name]);

    for (const table of tables) {
      const config = getTableConfig(table);
      const expected = config.columns.map((c) => c.name).sort();
      expect(actual.get(config.name)?.sort(), config.name).toEqual(expected);
    }
  });

  it('bisa dijalankan ulang tanpa error (idempoten)', async () => {
    await expect(runMigrations(database.handle.db)).resolves.toBeUndefined();
  });

  it('menyimpan dan membaca satu rangkaian data lintas tabel dengan FK', async () => {
    const { db } = database.handle;
    const [device] = await db
      .insert(schema.devices)
      .values({ kind: 'desktop', name: 'PC', tokenHash: 'hash', scopes: ['app'] })
      .returning();
    const [project] = await db
      .insert(schema.projects)
      .values({
        name: 'demo',
        workerDeviceId: device!.id,
        stack: { languages: ['ts'], frameworks: [] },
      })
      .returning();
    const [conversation] = await db
      .insert(schema.conversations)
      .values({ surface: 'windows', projectId: project!.id })
      .returning();
    const [run] = await db
      .insert(schema.runs)
      .values({ kind: 'coding', engine: 'omp', conversationId: conversation!.id })
      .returning();
    const [task] = await db
      .insert(schema.tasks)
      .values({ projectId: project!.id, title: 'Perbaiki login', runId: run!.id })
      .returning();
    await db.update(schema.runs).set({ taskId: task!.id }).where(eq(schema.runs.id, run!.id));
    const [linked] = await db.select().from(schema.runs).where(eq(schema.runs.id, run!.id));

    expect(IdSchema.safeParse(run!.id).success).toBe(true);
    expect(run).toMatchObject({ status: 'queued', usage: null, error: null });
    expect(task).toMatchObject({ status: 'backlog', position: 0 });
    expect(linked?.taskId).toBe(task!.id);
    expect(
      DeviceSchema.safeParse({
        id: device!.id,
        kind: device!.kind,
        name: device!.name,
        scopes: device!.scopes,
        lastSeenAt: null,
        createdAt: device!.createdAt.toISOString(),
      }).success,
    ).toBe(true);
  });

  it('menolak FK yatim dan nilai enum yang tidak ada', async () => {
    const { pool } = database.handle;
    await expect(
      pool.query(
        `insert into messages (id, conversation_id, author, parts) values ($1, $2, 'user', '[]')`,
        [uuidv7(), uuidv7()],
      ),
    ).rejects.toThrow();
    await expect(
      pool.query(
        `insert into runs (id, kind, engine, status) values ($1, 'chat', 'hermes', 'paused')`,
        [uuidv7()],
      ),
    ).rejects.toThrow();
  });
});
