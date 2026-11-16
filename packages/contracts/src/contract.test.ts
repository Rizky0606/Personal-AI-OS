import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { endpoints } from './api.js';
import {
  ApproveMemoryProposalRequestSchema,
  MemoryProposalQuerySchema,
  MemoryProposalSchema,
  UpdateMemoryRequestSchema,
} from './api-schemas.js';
import { PageQuerySchema, ProblemSchema } from './common.js';
import { MemorySchema, MessageSchema, RunSchema } from './entities.js';
import { ID_A, ID_B, ID_C, TS } from './fixtures.js';
import { serializeOpenApiDocument } from './openapi/document.js';
import {
  RUN_STATUS_TRANSITIONS,
  RunStatusSchema,
  TERMINAL_RUN_STATUSES,
  canTransition,
} from './run-status.js';
import {
  AIOS_DATA_TOOLS,
  AIOS_NETWORK_TOOLS,
  MemoryListInputSchema,
  ScheduleListInputSchema,
  SpaceSearchInputSchema,
  TaskListInputSchema,
  WebReadInputSchema,
  WebSearchInputSchema,
  aiosToolOf,
} from './tools.js';
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
  'GET /engines',
  'GET /quota',
  'POST /compare',
  'POST /review/opinion',
  'GET /roles',
  'GET /skills',
  'GET /skills/:id',
  'GET /conversations',
  'POST /conversations',
  'GET /conversations/:id',
  'GET /conversations/:id/progress',
  'PATCH /conversations/:id',
  'DELETE /conversations/:id',
  'POST /conversations/:id/handoff',
  'GET /conversations/:id/messages',
  'POST /conversations/:id/messages',
  'POST /messages/:id/fork',
  'POST /messages/:id/edit',
  'POST /fleets',
  'POST /teams',
  'GET /teams',
  'GET /teams/:id',
  'POST /teams/:id/cancel',
  'POST /teams/:id/members/:memberId/cancel',
  'DELETE /messages/:id',
  'GET /runs',
  'GET /runs/:id',
  'GET /runs/:id/events',
  'POST /runs/:id/steer',
  'POST /runs/:id/cancel',
  'POST /runs/:id/queue/remove',
  'POST /runs/:id/questions/:questionId',
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
  'POST /worker/artifacts/screenshot',
  'POST /mcp',
  'GET /mcp',
  'DELETE /mcp',
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
  'GET /memories/proposals',
  'POST /memories/proposals/:id/approve',
  'POST /memories/proposals/:id/reject',
  'POST /memories/proposals/:id/undo',
  'GET /spaces',
  'POST /spaces',
  'PATCH /spaces/:id',
  'DELETE /spaces/:id',
  'GET /spaces/:id/documents',
  'POST /spaces/:id/documents',
  'DELETE /spaces/:id/documents/:documentId',
  'POST /skills',
  'POST /skills/scan',
  'POST /skills/install/preview',
  'POST /skills/install',
  'GET /skills/hermes',
  'POST /skills/hermes/preview',
  'POST /skills/hermes/import',
  'GET /skills/proposals',
  'GET /skills/proposals/:id',
  'POST /skills/proposals/:id/approve',
  'POST /skills/proposals/:id/reject',
  'GET /skills/curator/report',
  'POST /skills/curator/run',
  'PATCH /skills/:id',
  'DELETE /skills/:id',
  'POST /skills/:id/status',
  'GET /skills/:id/versions',
  'POST /skills/:id/restore',
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
      // Satu-satunya pengecualian: GET /mcp yang menurut spesifikasi MCP dijawab 405 (tanpa aliran SSE).
      if (e.operationId === 'mcpStream') {
        expect(e.responses).toEqual([]);
        expect(e.errors).toEqual([405]);
        continue;
      }
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
      bundle: { role: 'frontend', systemPrompt: '...', skillIds: [] },
      model: 'coding-main',
    };
    expect(WorkerCommandSchema.safeParse(start).success).toBe(true);
    expect(WorkerCommandSchema.safeParse({ ...start, model: '' }).success).toBe(false);
    expect(WorkerCommandSchema.safeParse({ type: 'run.cancel' }).success).toBe(false);
  });

  it('run.start: gatewayTools opsional dan aditif (worker lama mengabaikannya)', () => {
    const start = {
      type: 'run.start',
      runId: ID_A,
      projectId: ID_B,
      prompt: 'Cari dokumentasi',
      bundle: { role: 'general', systemPrompt: '', skillIds: [] },
      model: 'coding-main',
    };
    const parsed = WorkerCommandSchema.parse({ ...start, gatewayTools: true });
    expect(parsed).toMatchObject({ gatewayTools: true });
    expect(WorkerCommandSchema.parse(start)).not.toHaveProperty('gatewayTools');
    expect(WorkerCommandSchema.safeParse({ ...start, gatewayTools: 'ya' }).success).toBe(false);
  });
});

describe('tool gateway (aios_tools)', () => {
  it('mengenali nama tool omp dan Hermes, menolak yang lain', () => {
    expect(aiosToolOf('mcp__aios_tools_web_search')).toBe('web_search');
    expect(aiosToolOf('mcp__aios_tools__web_read')).toBe('web_read');
    expect(aiosToolOf('mcp__aios_tools_memory_list')).toBe('memory_list');
    expect(aiosToolOf('mcp__aios_tools__space_search')).toBe('space_search');
    expect(aiosToolOf('mcp__aios_tools_task_list')).toBe('task_list');
    expect(aiosToolOf('mcp__aios_tools_schedule_list')).toBe('schedule_list');
    expect(aiosToolOf('mcp__aios_tools_memory_propose')).toBeNull();
    expect(aiosToolOf('mcp__aios_browser_browser_screenshot')).toBeNull();
    expect(aiosToolOf('web_search')).toBeNull();
  });

  it('tool data dan tool jaringan terpisah', () => {
    expect(AIOS_DATA_TOOLS.filter((t) => AIOS_NETWORK_TOOLS.includes(t))).toEqual([]);
    expect([...AIOS_NETWORK_TOOLS, ...AIOS_DATA_TOOLS]).toHaveLength(6);
  });

  it('skema masukan tool data', () => {
    const id = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';
    expect(MemoryListInputSchema.safeParse({}).success).toBe(true);
    expect(MemoryListInputSchema.safeParse({ query: 'x'.repeat(201) }).success).toBe(false);
    expect(SpaceSearchInputSchema.safeParse({ query: 'kontrak', spaceId: id }).success).toBe(true);
    expect(SpaceSearchInputSchema.safeParse({ query: '' }).success).toBe(false);
    expect(SpaceSearchInputSchema.safeParse({ query: 'a', spaceId: 'bukan' }).success).toBe(false);
    expect(TaskListInputSchema.safeParse({ status: 'todo' }).success).toBe(true);
    expect(TaskListInputSchema.safeParse({ status: 'draf' }).success).toBe(false);
    expect(ScheduleListInputSchema.safeParse({}).success).toBe(true);
    expect(ScheduleListInputSchema.safeParse({ limit: 5 }).success).toBe(false);
  });

  it('skema masukan membatasi kueri dan menolak argumen asing', () => {
    expect(WebSearchInputSchema.safeParse({ query: 'vite 7' }).success).toBe(true);
    expect(WebSearchInputSchema.safeParse({ query: ' ' }).success).toBe(false);
    expect(WebSearchInputSchema.safeParse({ query: 'x'.repeat(201) }).success).toBe(false);
    expect(WebSearchInputSchema.safeParse({ query: 'a', limit: 9 }).success).toBe(false);
    expect(WebSearchInputSchema.safeParse({ query: 'a', host: 'x' }).success).toBe(false);
    expect(WebReadInputSchema.safeParse({ url: 'https://example.com' }).success).toBe(true);
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

  it('Memory: jawaban server lama tanpa pinned tetap sah; PATCH boleh hanya pinned', () => {
    const memory = { id: ID_A, text: 'Fakta', enabled: true, createdAt: TS, updatedAt: TS };
    expect(MemorySchema.parse(memory).pinned).toBe(false);
    expect(MemorySchema.parse({ ...memory, pinned: true }).pinned).toBe(true);
    expect(UpdateMemoryRequestSchema.safeParse({ pinned: true }).success).toBe(true);
    expect(UpdateMemoryRequestSchema.safeParse({}).success).toBe(false);
    expect(UpdateMemoryRequestSchema.safeParse({ pinned: 'ya' }).success).toBe(false);
  });

  it('Memory: server lama tanpa source/origin = owner tanpa asal; extracted membawa asal percakapan', () => {
    const memory = { id: ID_A, text: 'Fakta', enabled: true, createdAt: TS, updatedAt: TS };
    const old = MemorySchema.parse(memory);
    expect(old.source).toBe('owner');
    expect(old.origin).toBeNull();
    const extracted = MemorySchema.parse({
      ...memory,
      source: 'extracted',
      origin: { conversationId: ID_B, messageId: null },
    });
    expect(extracted.origin).toEqual({ conversationId: ID_B, messageId: null });
    expect(MemorySchema.safeParse({ ...memory, source: 'agent' }).success).toBe(false);
  });

  it('MemoryProposal: status dan kind tertutup; approve boleh tanpa badan; query status', () => {
    const proposal = {
      id: ID_A,
      kind: 'add',
      status: 'pending',
      text: 'Pemilik tinggal di Bandung.',
      evidence: 'saya tinggal di Bandung',
      targetMemoryId: null,
      targetText: null,
      previousText: null,
      resultMemoryId: null,
      conversationId: ID_B,
      messageId: ID_C,
      runId: null,
      model: 'router-fast',
      createdAt: TS,
      decidedAt: null,
    };
    expect(MemoryProposalSchema.safeParse(proposal).success).toBe(true);
    expect(MemoryProposalSchema.safeParse({ ...proposal, status: 'auto_saved' }).success).toBe(
      true,
    );
    expect(MemoryProposalSchema.safeParse({ ...proposal, status: 'saved' }).success).toBe(false);
    expect(MemoryProposalSchema.safeParse({ ...proposal, kind: 'delete' }).success).toBe(false);
    expect(ApproveMemoryProposalRequestSchema.safeParse({}).success).toBe(true);
    expect(ApproveMemoryProposalRequestSchema.parse({ text: '  Teks baru ' }).text).toBe(
      'Teks baru',
    );
    expect(ApproveMemoryProposalRequestSchema.safeParse({ text: ' ' }).success).toBe(false);
    expect(MemoryProposalQuerySchema.safeParse({ status: 'all' }).success).toBe(true);
    expect(MemoryProposalQuerySchema.safeParse({ status: 'semua' }).success).toBe(false);
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
