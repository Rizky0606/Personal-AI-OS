import { AgentEventSchema, type AgentEvent } from '@aios/contracts';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AcpConnection, type AcpTransport } from './acp/rpc.js';
import { createDshAdapter } from './dsh.js';
import { AsyncQueue } from './queue.js';
import { acpReplayTransport, type AcpReplayTransport } from './testing/acp-replay.js';
import type { RunHandle } from './types.js';

/**
 * Tes berbasis transkrip ACP. Fixture di src/__fixtures__/dsh adalah SINTETIS (dari spesifikasi ACP v1 dan README
 * dsh-acp), bukan rekaman nyata dsh: lihat docs/ADAPTER_ACP.md. Snapshot mengunci urutan event kontrak.
 */
const FIXTURES = fileURLToPath(new URL('./__fixtures__/dsh/', import.meta.url));
const RUN = '0192f0c4-7a1b-7c2d-9e3f-4a5b6c7d8e90';
const MESSAGE = '0192f0c4-7a1b-7c2d-9e3f-4a5b6c7d8e91';

type Reaction = (event: AgentEvent, handle: RunHandle) => Promise<void> | void;

interface Result {
  events: AgentEvent[];
  transport: AcpReplayTransport;
  unknown: string[];
}

async function replay(
  name: string,
  react: Reaction = () => undefined,
  options: { approvalTimeoutMs?: number } = {},
): Promise<Result> {
  const transport = acpReplayTransport(`${FIXTURES}${name}.jsonl`);
  const unknown: string[] = [];
  let clock = 0;
  let ids = 0;
  const adapter = createDshAdapter({
    launch: () => transport,
    now: () => (clock += 10),
    newId: () => `0192f0c4-7a1b-7c2d-9e3f-4a5b6c7d8f${String(++ids).padStart(2, '0')}`,
    onUnknown: (kind) => unknown.push(kind),
    abortGraceMs: 200,
    ...options,
  });
  const handle = await adapter.startRun({
    runId: RUN,
    messageId: MESSAGE,
    prompt: 'tes',
    cwd: '/work/run-1',
  });
  const events: AgentEvent[] = [];
  for await (const event of handle.events) {
    events.push(event);
    await react(event, handle);
  }
  await handle.cancel(); // sesudah selesai: no-op, tidak boleh melempar
  return { events, transport, unknown };
}

const allow: Reaction = async (event, handle) => {
  if (event.type === 'approval.requested') await handle.resolveApproval(event.approvalId, 'allow');
};
const deny: Reaction = async (event, handle) => {
  if (event.type === 'approval.requested') await handle.resolveApproval(event.approvalId, 'deny');
};

const types = (events: AgentEvent[]) => events.map((e) => e.type);

describe('dsh (ACP) replay', () => {
  it('text-only: reasoning, pesan, penutup', async () => {
    const { events, transport } = await replay('text-only');
    expect(events).toMatchSnapshot();
    expect(transport.mismatches).toEqual([]);
    expect(transport.inputClosed).toBe(true);
  });

  it('tool disetujui: output hanya tambahan, durasi dari jam adapter', async () => {
    const { events, transport } = await replay('tool-approve', allow);
    expect(events).toMatchSnapshot();
    expect(transport.mismatches).toEqual([]);
  });

  it('tool ditolak: tool.finished denied', async () => {
    const { events, transport } = await replay('tool-deny', deny);
    expect(events).toMatchSnapshot();
    expect(transport.mismatches).toEqual([]);
    expect(events.find((e) => e.type === 'tool.finished')).toMatchObject({ status: 'denied' });
  });

  it('izin kedaluwarsa: ditolak otomatis dengan reject_once', async () => {
    const { events, transport } = await replay('permission-expired', () => undefined, {
      approvalTimeoutMs: 20,
    });
    expect(transport.mismatches).toEqual([]);
    expect(events.find((e) => e.type === 'approval.resolved')).toMatchObject({ decision: 'deny' });
    expect(events.find((e) => e.type === 'tool.finished')).toMatchObject({ status: 'denied' });
    expect(events.at(-1)?.type).toBe('run.completed');
  });

  it('cancel saat tool berjalan: tool cancelled, tanpa event penutup', async () => {
    const { events, transport } = await replay('cancel-tool', async (event, handle) => {
      if (event.type === 'tool.started') await handle.cancel();
    });
    expect(events).toMatchSnapshot();
    expect(transport.mismatches).toEqual([]);
    expect(transport.killed).toBe(false);
  });

  it('cancel dengan izin menggantung: dijawab cancelled sebelum session/cancel', async () => {
    const { events, transport } = await replay('cancel-approval', async (event, handle) => {
      if (event.type === 'approval.requested') await handle.cancel();
    });
    expect(events).toMatchSnapshot();
    expect(transport.mismatches).toEqual([]);
  });

  it('proses mati di tengah run: tool error lalu error acp_exited', async () => {
    const { events } = await replay('crash-mid-run');
    expect(events).toMatchSnapshot();
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'acp_exited', retryable: true });
  });

  it('event dan metode tak dikenal diabaikan, dicatat, dan run tetap selesai', async () => {
    const { events, transport, unknown } = await replay('unknown-events');
    expect(events).toMatchSnapshot();
    expect(transport.mismatches).toEqual([]);
    expect(unknown).toEqual([
      'session_update:plan',
      'session_update:masa_depan',
      'notification:x/unknown',
      'request:fs/read_text_file',
      'invalid_line',
    ]);
    expect(events.at(-1)?.type).toBe('run.completed');
  });

  it('galat JSON-RPC -32000 menjadi acp_auth_required', async () => {
    const { events } = await replay('rpc-error');
    expect(events).toEqual([
      expect.objectContaining({ type: 'error', code: 'acp_auth_required', retryable: false }),
    ]);
  });

  it('refusal menjadi error acp_refusal', async () => {
    const { events } = await replay('refusal');
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'acp_refusal' });
  });

  it('semua event lolos skema kontrak', async () => {
    for (const [name, react] of [
      ['text-only', undefined],
      ['tool-approve', allow],
      ['tool-deny', deny],
      ['crash-mid-run', undefined],
      ['unknown-events', undefined],
    ] as const) {
      const { events } = await replay(name, react);
      for (const event of events) {
        expect(AgentEventSchema.safeParse(event).success, `${name}: ${event.type}`).toBe(true);
      }
      expect(types(events).filter((t) => t === 'run.status')).toEqual([]);
    }
  });
});

/** Transport yang tidak pernah menjawab, untuk batas waktu. */
function silentTransport(): AcpTransport & { killed: boolean } {
  const queue = new AsyncQueue<string>();
  let resolveExit: (v: { code: number | null }) => void = () => undefined;
  const exited = new Promise<{ code: number | null }>((r) => (resolveExit = r));
  const t = {
    killed: false,
    lines: queue,
    exited,
    write: () => undefined,
    closeInput: () => undefined,
    kill: () => {
      t.killed = true;
      queue.end();
      resolveExit({ code: null });
    },
  };
  return t;
}

describe('dsh batas waktu', () => {
  it('initialize tanpa jawaban: error acp_timeout, proses dimatikan, stream berakhir', async () => {
    const transport = silentTransport();
    const adapter = createDshAdapter({ launch: () => transport, startupTimeoutMs: 30 });
    const handle = await adapter.startRun({
      runId: RUN,
      messageId: MESSAGE,
      prompt: 'x',
      cwd: '/w',
    });
    const events: AgentEvent[] = [];
    for await (const e of handle.events) events.push(e);
    expect(events).toEqual([
      expect.objectContaining({ type: 'error', code: 'acp_timeout', retryable: true }),
    ]);
    expect(transport.killed).toBe(true);
  });

  it('batas total run: error acp_run_timeout tidak retryable', async () => {
    const transport = silentTransport();
    const adapter = createDshAdapter({ launch: () => transport, maxRunMs: 30 });
    const handle = await adapter.startRun({
      runId: RUN,
      messageId: MESSAGE,
      prompt: 'x',
      cwd: '/w',
    });
    const events: AgentEvent[] = [];
    for await (const e of handle.events) events.push(e);
    expect(events).toEqual([
      expect.objectContaining({ type: 'error', code: 'acp_run_timeout', retryable: false }),
    ]);
    expect(transport.killed).toBe(true);
  });

  it('cwd wajib', async () => {
    const adapter = createDshAdapter({ launch: () => silentTransport() });
    await expect(
      adapter.startRun({ runId: RUN, messageId: MESSAGE, prompt: 'x' }),
    ).rejects.toMatchObject({
      code: 'acp_config',
    });
  });
});

describe('AcpConnection', () => {
  it('request yang menunggu ditolak saat proses berhenti', async () => {
    const transport = silentTransport();
    const conn = new AcpConnection(transport, {
      onNotification: () => undefined,
      onRequest: () => Promise.reject(new Error('x')),
      onClose: () => undefined,
    });
    const pending = conn.request('session/prompt', {});
    transport.kill();
    await expect(pending).rejects.toMatchObject({ code: 'acp_exited' });
    await expect(conn.request('x', {})).rejects.toMatchObject({ code: 'acp_exited' });
  });
});
