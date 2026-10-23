import { describe, expect, it } from 'vitest';
import {
  AgentEventSchema,
  UserEventSchema,
  type AgentEventType,
  type UserEvent,
} from './events.js';
import { ID_A, ID_B, TS } from './fixtures.js';

interface Cases {
  valid: unknown[];
  invalid: unknown[];
}

const usage = { inputTokens: 120, outputTokens: 48 };

/* Record dengan kunci union: menambah tipe event tanpa contoh membuat typecheck gagal. */
const agentCases: Record<AgentEventType, Cases> = {
  'run.status': {
    valid: [{ type: 'run.status', status: 'waiting_approval' }],
    invalid: [{ type: 'run.status', status: 'paused' }, { type: 'run.status' }],
  },
  'route.decided': {
    valid: [{ type: 'route.decided', role: 'frontend', confidence: 0.91, reason: 'Ubah tombol' }],
    invalid: [
      { type: 'route.decided', role: 'frontend', confidence: 1.5, reason: 'x' },
      { type: 'route.decided', role: 'Frontend', confidence: 0.5, reason: 'x' },
      { type: 'route.decided', role: 'frontend', confidence: 0.5 },
    ],
  },
  'message.delta': {
    valid: [{ type: 'message.delta', messageId: ID_A, text: 'Halo' }],
    invalid: [
      { type: 'message.delta', messageId: 'bukan-uuid', text: 'Halo' },
      { type: 'message.delta', messageId: ID_A, text: 42 },
    ],
  },
  'message.completed': {
    valid: [
      { type: 'message.completed', messageId: ID_A },
      { type: 'message.completed', messageId: ID_A, usage },
    ],
    invalid: [
      { type: 'message.completed', messageId: ID_A, usage: { inputTokens: -1, outputTokens: 0 } },
      { type: 'message.completed' },
    ],
  },
  'reasoning.delta': {
    valid: [{ type: 'reasoning.delta', messageId: ID_A, text: 'Memeriksa...' }],
    invalid: [{ type: 'reasoning.delta', text: 'tanpa messageId' }],
  },
  'tool.started': {
    valid: [
      { type: 'tool.started', toolCallId: 'call_1', name: 'bash' },
      { type: 'tool.started', toolCallId: 'call_1', name: 'edit', target: 'src/app.ts' },
    ],
    invalid: [
      { type: 'tool.started', toolCallId: '', name: 'bash' },
      { type: 'tool.started', toolCallId: 'call_1' },
    ],
  },
  'tool.output': {
    valid: [
      { type: 'tool.output', toolCallId: 'call_1', chunk: 'ok\n' },
      { type: 'tool.output', toolCallId: 'call_1', chunk: 'err', stream: 'stderr' },
    ],
    invalid: [
      { type: 'tool.output', toolCallId: 'call_1', chunk: 'x', stream: 'stdin' },
      { type: 'tool.output', toolCallId: 'call_1' },
    ],
  },
  'tool.finished': {
    valid: [{ type: 'tool.finished', toolCallId: 'call_1', status: 'ok', durationMs: 335 }],
    invalid: [
      { type: 'tool.finished', toolCallId: 'call_1', status: 'running', durationMs: 1 },
      { type: 'tool.finished', toolCallId: 'call_1', status: 'ok', durationMs: -5 },
      { type: 'tool.finished', toolCallId: 'call_1', status: 'ok' },
    ],
  },
  'approval.requested': {
    valid: [
      {
        type: 'approval.requested',
        approvalId: ID_B,
        kind: 'command',
        detail: 'pnpm install',
        cwd: '/work/app',
      },
      {
        type: 'approval.requested',
        approvalId: ID_B,
        kind: 'network',
        detail: 'https://example.com',
      },
    ],
    invalid: [
      { type: 'approval.requested', approvalId: ID_B, kind: 'delete', detail: 'rm -rf x' },
      { type: 'approval.requested', approvalId: ID_B, kind: 'command' },
    ],
  },
  'approval.resolved': {
    valid: [{ type: 'approval.resolved', approvalId: ID_B, decision: 'allow', remember: false }],
    invalid: [
      { type: 'approval.resolved', approvalId: ID_B, decision: 'maybe', remember: false },
      { type: 'approval.resolved', approvalId: ID_B, decision: 'deny' },
    ],
  },
  'diff.updated': {
    valid: [
      { type: 'diff.updated', files: [] },
      { type: 'diff.updated', files: [{ path: 'src/a.ts', additions: 12, deletions: 3 }] },
    ],
    invalid: [
      { type: 'diff.updated', files: [{ path: 'src/a.ts', additions: -1, deletions: 0 }] },
      { type: 'diff.updated', files: [{ path: '', additions: 1, deletions: 0 }] },
      { type: 'diff.updated' },
    ],
  },
  'checkpoint.created': {
    valid: [{ type: 'checkpoint.created', checkpointId: 'cp_1', label: 'Sebelum refactor' }],
    invalid: [{ type: 'checkpoint.created', label: 'tanpa id' }],
  },
  'preview.ready': {
    valid: [{ type: 'preview.ready', url: 'http://127.0.0.1:5173/' }],
    invalid: [{ type: 'preview.ready', url: 'bukan url' }, { type: 'preview.ready' }],
  },
  'research.progress': {
    valid: [
      { type: 'research.progress', stage: 'searching', progress: 0.4 },
      { type: 'research.progress', stage: 'writing', progress: 1, message: 'Menyusun laporan' },
    ],
    invalid: [
      { type: 'research.progress', stage: 'thinking', progress: 0.4 },
      { type: 'research.progress', stage: 'reading', progress: 1.2 },
    ],
  },
  'research.source': {
    valid: [
      { type: 'research.source', sourceId: ID_A, url: 'https://example.com/a', title: 'Contoh' },
    ],
    invalid: [
      { type: 'research.source', sourceId: ID_A, url: 'example.com', title: 'Contoh' },
      { type: 'research.source', sourceId: ID_A, title: 'Contoh' },
    ],
  },
  error: {
    valid: [{ type: 'error', code: 'model_unavailable', message: 'Kuota habis', retryable: true }],
    invalid: [
      { type: 'error', code: '', message: 'x', retryable: true },
      { type: 'error', code: 'x', message: 'x' },
    ],
  },
  'run.completed': {
    valid: [
      { type: 'run.completed', summary: 'Selesai' },
      { type: 'run.completed', summary: 'Selesai', usage },
    ],
    invalid: [
      { type: 'run.completed' },
      { type: 'run.completed', summary: 'x', usage: { inputTokens: 1 } },
    ],
  },
};

const task = {
  id: ID_A,
  projectId: ID_B,
  title: 'Perbaiki login',
  body: '',
  status: 'review',
  position: 0,
  agentRole: 'frontend',
  runId: null,
  branch: 'feat/login',
  diffStat: { files: 2, additions: 12, deletions: 3 },
  createdAt: TS,
  updatedAt: TS,
};

const userCases: Record<UserEvent['type'], Cases> = {
  'task.updated': {
    valid: [{ type: 'task.updated', task }],
    invalid: [
      { type: 'task.updated', task: { ...task, status: 'doing' } },
      { type: 'task.updated' },
    ],
  },
  'schedule.result': {
    valid: [
      {
        type: 'schedule.result',
        scheduleId: ID_A,
        scheduleRunId: ID_B,
        runId: null,
        status: 'succeeded',
      },
    ],
    invalid: [
      { type: 'schedule.result', scheduleId: ID_A, scheduleRunId: ID_B, runId: null, status: 'ok' },
      { type: 'schedule.result', scheduleId: ID_A },
    ],
  },
  'research.completed': {
    valid: [{ type: 'research.completed', researchId: ID_A, runId: ID_B }],
    invalid: [{ type: 'research.completed', runId: ID_B }],
  },
  notification: {
    valid: [
      { type: 'notification', title: 'Run selesai', level: 'info' },
      { type: 'notification', title: 'Kuota menipis', body: 'Sisa 10%', level: 'warning' },
    ],
    invalid: [
      { type: 'notification', title: '', level: 'info' },
      { type: 'notification', title: 'x', level: 'fatal' },
    ],
  },
};

describe('AgentEvent', () => {
  it('punya contoh untuk setiap anggota union (dan sebaliknya)', () => {
    const inUnion = AgentEventSchema.options.map((o) => o.shape.type.value).sort();
    expect(inUnion).toEqual(Object.keys(agentCases).sort());
  });

  it('mencakup seluruh tipe di API_CONTRACT.md', () => {
    expect(Object.keys(agentCases).sort()).toEqual(
      [
        'run.status',
        'route.decided',
        'message.delta',
        'message.completed',
        'reasoning.delta',
        'tool.started',
        'tool.output',
        'tool.finished',
        'approval.requested',
        'approval.resolved',
        'diff.updated',
        'checkpoint.created',
        'preview.ready',
        'research.progress',
        'research.source',
        'error',
        'run.completed',
      ].sort(),
    );
  });

  describe.each(Object.entries(agentCases))('%s', (_type, { valid, invalid }) => {
    it.each(valid.map((v, i) => [i, v] as const))('menerima contoh valid #%i', (_i, event) => {
      expect(AgentEventSchema.safeParse(event).success).toBe(true);
    });
    it.each(invalid.map((v, i) => [i, v] as const))(
      'menolak contoh tidak valid #%i',
      (_i, event) => {
        expect(AgentEventSchema.safeParse(event).success).toBe(false);
      },
    );
  });

  it('menolak tipe tak dikenal dan nilai bukan objek', () => {
    expect(AgentEventSchema.safeParse({ type: 'tool.exploded' }).success).toBe(false);
    expect(AgentEventSchema.safeParse(null).success).toBe(false);
    expect(AgentEventSchema.safeParse('run.status').success).toBe(false);
  });

  it('tidak menerima event channel user', () => {
    expect(AgentEventSchema.safeParse(userCases.notification.valid[0]).success).toBe(false);
  });
});

describe('UserEvent', () => {
  it('punya contoh untuk setiap anggota union', () => {
    const inUnion = UserEventSchema.options.map((o) => o.shape.type.value).sort();
    expect(inUnion).toEqual(Object.keys(userCases).sort());
  });

  describe.each(Object.entries(userCases))('%s', (_type, { valid, invalid }) => {
    it.each(valid.map((v, i) => [i, v] as const))('menerima contoh valid #%i', (_i, event) => {
      expect(UserEventSchema.safeParse(event).success).toBe(true);
    });
    it.each(invalid.map((v, i) => [i, v] as const))(
      'menolak contoh tidak valid #%i',
      (_i, event) => {
        expect(UserEventSchema.safeParse(event).success).toBe(false);
      },
    );
  });
});
