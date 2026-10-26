import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { endpoints } from './api.js';
import { PageQuerySchema, ProblemSchema } from './common.js';
import { MessageSchema, RunSchema } from './entities.js';
import { ID_A, ID_B, ID_C, TS } from './fixtures.js';
import { serializeOpenApiDocument } from './openapi/document.js';
import {
  RUN_STATUS_TRANSITIONS,
  RunStatusSchema,
  TERMINAL_RUN_STATUSES,
  canTransition,
} from './run-status.js';
import { WorkerCommandSchema } from './worker.js';
import { ChannelSchema, ClientMessageSchema, EventEnvelopeSchema } from './ws.js';

/** Tabel "Endpoint REST" di docs/API_CONTRACT.md, satu baris per method + path. */
const DOCUMENTED_ENDPOINTS = [
  'POST /auth/login',
  'POST /auth/refresh',
  'POST /auth/logout',
  'GET /devices',
  'DELETE /devices/:id',
  'POST /devices/:id/push-token',
  'POST /devices/worker',
  'GET /models',
  'GET /quota',
  'POST /compare',
  'POST /review/opinion',
  'GET /roles',
  'POST /route/preview',
  'GET /conversations',
  'POST /conversations',
  'PATCH /conversations/:id',
  'DELETE /conversations/:id',
  'GET /conversations/:id/messages',
  'POST /conversations/:id/messages',
  'POST /messages/:id/reroute',
  'POST /messages/:id/edit',
  'DELETE /messages/:id',
  'GET /runs',
  'GET /runs/:id',
  'GET /runs/:id/events',
  'POST /runs/:id/steer',
  'POST /runs/:id/cancel',
  'POST /runs/:id/approvals/:approvalId',
  'POST /runs/:id/review',
  'GET /projects',
  'POST /projects',
  'PATCH /projects/:id',
  'DELETE /projects/:id',
  'GET /projects/:id/tasks',
  'POST /tasks',
  'PATCH /tasks/:id',
  'POST /tasks/:id/run',
  'POST /tasks/breakdown',
  'GET /schedules',
  'POST /schedules',
  'PATCH /schedules/:id',
  'DELETE /schedules/:id',
  'POST /schedules/parse',
  'POST /schedules/:id/run-now',
  'GET /schedules/:id/runs',
  'POST /research',
  'GET /research',
  'GET /research/:id',
  'POST /research/:id/cancel',
  'GET /research/:id/export',
  'POST /files',
  'GET /files/:id/download',
  'GET /search',
  'GET /prompt-templates',
  'POST /prompt-templates',
  'PATCH /prompt-templates/:id',
  'DELETE /prompt-templates/:id',
  'GET /memories',
  'POST /memories',
  'PATCH /memories/:id',
  'DELETE /memories/:id',
  'GET /spaces',
  'POST /spaces',
  'PATCH /spaces/:id',
  'DELETE /spaces/:id',
  'GET /spaces/:id/documents',
  'POST /spaces/:id/documents',
  'DELETE /spaces/:id/documents/:documentId',
  'GET /healthz',
  'GET /readyz',
  'GET /status',
];

describe('endpoint REST', () => {
  it('sama persis dengan tabel di API_CONTRACT.md', () => {
    const actual = endpoints.map(
      (e) => `${e.method.toUpperCase()} ${e.path.replace(/\{(\w+)\}/g, ':$1')}`,
    );
    expect(actual.sort()).toEqual([...DOCUMENTED_ENDPOINTS].sort());
  });

  it('operationId unik dan setiap endpoint punya respons sukses', () => {
    const ids = endpoints.map((e) => e.operationId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of endpoints) {
      expect(
        e.responses.some((r) => r.status >= 200 && r.status < 300),
        e.operationId,
      ).toBe(true);
    }
  });

  it('parameter path di skema sama dengan placeholder di path', () => {
    for (const e of endpoints) {
      const placeholders = [...e.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      const declared = Object.keys(e.params?.shape ?? {}).sort();
      expect(declared, e.operationId).toEqual(placeholders);
    }
  });

  it('endpoint publik hanya login, refresh, dan health', () => {
    const open = endpoints
      .filter((e) => !e.auth)
      .map((e) => e.operationId)
      .sort();
    expect(open).toEqual(['healthz', 'login', 'readyz', 'refreshToken']);
  });
});

describe('error RFC 9457', () => {
  it('menerima Problem lengkap', () => {
    const ok = ProblemSchema.safeParse({
      type: 'https://aios.example/problems/not-found',
      title: 'Tidak ditemukan',
      status: 404,
      detail: 'Run tidak ada',
      code: 'run_not_found',
    });
    expect(ok.success).toBe(true);
  });

  it('menolak status non-error dan field wajib hilang', () => {
    expect(
      ProblemSchema.safeParse({ type: 't', title: 't', status: 200, detail: 'd', code: 'c' })
        .success,
    ).toBe(false);
    expect(
      ProblemSchema.safeParse({ type: 't', title: 't', status: 400, detail: 'd' }).success,
    ).toBe(false);
  });
});

describe('status run', () => {
  it('menerima 11 status dan menolak lainnya', () => {
    expect(RunStatusSchema.options).toHaveLength(11);
    expect(RunStatusSchema.safeParse('paused').success).toBe(false);
  });

  it('mengikuti diagram: alur coding dan chat', () => {
    const coding = [
      'queued',
      'routing',
      'preparing',
      'running',
      'needs_review',
      'accepted',
    ] as const;
    for (let i = 0; i < coding.length - 1; i++) {
      expect(canTransition(coding[i]!, coding[i + 1]!)).toBe(true);
    }
    expect(canTransition('running', 'completed')).toBe(true);
    expect(canTransition('running', 'waiting_approval')).toBe(true);
    expect(canTransition('waiting_approval', 'running')).toBe(true);
    expect(canTransition('needs_review', 'rejected')).toBe(true);
  });

  it('menolak lompatan dan transisi dari status akhir', () => {
    expect(canTransition('queued', 'running')).toBe(false);
    expect(canTransition('queued', 'completed')).toBe(false);
    expect(canTransition('waiting_approval', 'needs_review')).toBe(false);
    for (const s of TERMINAL_RUN_STATUSES) expect(RUN_STATUS_TRANSITIONS[s]).toEqual([]);
  });

  it('semua status non-akhir bisa berakhir failed dan cancelled', () => {
    for (const s of RunStatusSchema.options) {
      if (TERMINAL_RUN_STATUSES.includes(s)) continue;
      expect(canTransition(s, 'failed'), s).toBe(true);
      expect(canTransition(s, 'cancelled'), s).toBe(true);
    }
  });
});

describe('WebSocket', () => {
  const envelope = {
    v: 1,
    channel: `run:${ID_A}`,
    seq: 42,
    ts: TS,
    event: { type: 'message.delta', messageId: ID_B, text: '...' },
  };

  it('menerima envelope dari contoh dokumen', () => {
    expect(EventEnvelopeSchema.safeParse(envelope).success).toBe(true);
    expect(
      EventEnvelopeSchema.safeParse({
        ...envelope,
        channel: 'user',
        event: { type: 'notification', title: 'x', level: 'info' },
      }).success,
    ).toBe(true);
  });

  it('menolak versi, seq, channel, dan event yang salah', () => {
    expect(EventEnvelopeSchema.safeParse({ ...envelope, v: 2 }).success).toBe(false);
    expect(EventEnvelopeSchema.safeParse({ ...envelope, seq: 0 }).success).toBe(false);
    expect(EventEnvelopeSchema.safeParse({ ...envelope, channel: 'run:abc' }).success).toBe(false);
    expect(EventEnvelopeSchema.safeParse({ ...envelope, event: { type: 'nope' } }).success).toBe(
      false,
    );
  });

  it('memvalidasi channel dan pesan subscribe', () => {
    expect(ChannelSchema.safeParse('user').success).toBe(true);
    expect(ChannelSchema.safeParse(`conversation:${ID_C}`).success).toBe(true);
    expect(ChannelSchema.safeParse('room:1').success).toBe(false);
    expect(
      ClientMessageSchema.safeParse({ type: 'subscribe', channel: `run:${ID_A}`, lastSeq: 41 })
        .success,
    ).toBe(true);
    expect(
      ClientMessageSchema.safeParse({ type: 'subscribe', channel: `run:${ID_A}`, lastSeq: -1 })
        .success,
    ).toBe(false);
    expect(ClientMessageSchema.safeParse({ type: 'subscribe' }).success).toBe(false);
  });
});

describe('protokol worker', () => {
  it('menerima run.start dan menolak yang kurang', () => {
    const start = {
      type: 'run.start',
      runId: ID_A,
      projectId: ID_B,
      prompt: 'Ubah tombol',
      bundle: { role: 'frontend', systemPrompt: '...' },
      model: 'coding-main',
    };
    expect(WorkerCommandSchema.safeParse(start).success).toBe(true);
    expect(WorkerCommandSchema.safeParse({ ...start, model: '' }).success).toBe(false);
    expect(WorkerCommandSchema.safeParse({ type: 'run.cancel' }).success).toBe(false);
  });
});

describe('entitas', () => {
  const run = {
    id: ID_A,
    kind: 'coding',
    engine: 'omp',
    agentRole: 'frontend',
    model: 'coding-main',
    status: 'running',
    conversationId: ID_B,
    taskId: null,
    branch: 'feat/x',
    usage: null,
    error: null,
    createdAt: TS,
    updatedAt: TS,
  };

  it('Run: valid dan tidak valid', () => {
    expect(RunSchema.safeParse(run).success).toBe(true);
    expect(RunSchema.safeParse({ ...run, status: 'paused' }).success).toBe(false);
    expect(RunSchema.safeParse({ ...run, engine: 'claude' }).success).toBe(false);
    expect(RunSchema.safeParse({ ...run, id: 'bukan-uuid' }).success).toBe(false);
    expect(RunSchema.safeParse({ ...run, createdAt: '2026-10-22 06:38' }).success).toBe(false);
  });

  it('Message: bagian pesan terpisah menurut tipe', () => {
    const msg = {
      id: ID_A,
      conversationId: ID_B,
      author: 'assistant',
      parts: [
        { type: 'text', text: 'Selesai' },
        { type: 'tool', toolCallId: 'c1', name: 'bash', status: 'ok', durationMs: 12 },
      ],
      agentRole: 'general',
      model: null,
      runId: null,
      createdAt: TS,
    };
    expect(MessageSchema.safeParse(msg).success).toBe(true);
    expect(MessageSchema.safeParse({ ...msg, parts: [{ type: 'image' }] }).success).toBe(false);
    expect(MessageSchema.safeParse({ ...msg, author: 'tool' }).success).toBe(false);
  });

  it('pagination: default 50, maksimum 100', () => {
    expect(PageQuerySchema.parse({}).limit).toBe(50);
    expect(PageQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(PageQuerySchema.parse({ limit: '20', before: ID_A }).limit).toBe(20);
  });
});

describe('openapi.json', () => {
  it('sama dengan hasil generator (jalankan pnpm --filter @aios/contracts build bila gagal)', () => {
    const committed = readFileSync(new URL('../openapi.json', import.meta.url), 'utf8');
    expect(committed).toBe(serializeOpenApiDocument());
  });

  it('memuat semua operasi dan skema kunci', () => {
    const doc = JSON.parse(serializeOpenApiDocument()) as {
      openapi: string;
      paths: Record<string, Record<string, unknown>>;
      components: { schemas: Record<string, unknown>; securitySchemes: Record<string, unknown> };
    };
    expect(doc.openapi).toBe('3.1.0');
    const operations = Object.values(doc.paths).reduce((n, p) => n + Object.keys(p).length, 0);
    expect(operations).toBe(endpoints.length);
    for (const name of [
      'AgentEvent',
      'UserEvent',
      'EventEnvelope',
      'Problem',
      'Run',
      'RunStatus',
    ]) {
      expect(doc.components.schemas, name).toHaveProperty(name);
    }
    expect(doc.components.securitySchemes).toHaveProperty('bearerAuth');
    const refs = [
      ...JSON.stringify(doc).matchAll(/"\$ref":"#\/components\/schemas\/([^"]+)"/g),
    ].map((m) => m[1]);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of new Set(refs))
      expect(doc.components.schemas, `$ref ${ref ?? ''}`).toHaveProperty(ref ?? '');
  });
});
