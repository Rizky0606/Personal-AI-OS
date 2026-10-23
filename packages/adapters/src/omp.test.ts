import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentEvent } from '@aios/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createOmpAdapter, pickOption, type OmpTransport } from './omp.js';
import { AsyncQueue } from './queue.js';
import { replayTransport, type ReplayTransport } from './testing/replay.js';
import { AdapterError, type RunHandle, type StartRunInput } from './types.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'omp');
const RUN = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';
const MESSAGE = '0192f0c4-7a1b-7c2d-9e3f-4a5b6c7d8e90';

let runDir: string;
beforeEach(async () => {
  runDir = await mkdtemp(join(tmpdir(), 'omp-adapter-'));
});
afterEach(async () => {
  await rm(runDir, { recursive: true, force: true });
});

let ids = 0;
const input = (over: Partial<StartRunInput> = {}): StartRunInput => ({
  runId: RUN,
  messageId: MESSAGE,
  prompt: 'kerjakan tugas',
  systemPrompt: '# Peran: Uji\nJawab singkat.',
  model: 'mock-1',
  cwd: 'C:\\work\\repo',
  runDir,
  ...over,
});

async function launchReplay(
  fixture: string,
  over: Partial<StartRunInput> = {},
): Promise<{
  handle: RunHandle;
  transport: ReplayTransport;
  launched: { args: string[]; env: Record<string, string> };
}> {
  const transport = replayTransport(join(FIXTURES, `${fixture}.jsonl`));
  const launched = { args: [] as string[], env: {} as Record<string, string> };
  const adapter = createOmpAdapter({
    launch: (spec) => {
      launched.args = spec.args;
      launched.env = spec.env;
      return transport;
    },
    llm: { baseUrl: 'http://127.0.0.1:4555/v1', apiKey: 'kunci-lokal' },
    newId: () => `0192f0c4-7a1b-7c2d-a${String(++ids).padStart(3, '0')}-4a5b6c7d8e91`,
    abortGraceMs: 500,
  });
  const handle = await adapter.startRun(input(over));
  return { handle, transport, launched };
}

/** Membaca semua event; `react` dipanggil per event untuk meniru klien (jawab izin, steer, batal). */
async function collect(
  handle: RunHandle,
  react: (event: AgentEvent) => Promise<void> | void = () => undefined,
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of handle.events) {
    events.push(event);
    await react(event);
  }
  return events;
}

const types = (events: AgentEvent[]) => events.map((e) => e.type);

describe('peluncuran omp', () => {
  it('argumen aman: approval always-ask, cwd = worktree, tanpa sesi/skill/ekstensi, role dari berkas di luar worktree', async () => {
    const { handle, launched } = await launchReplay('text-only');
    await collect(handle);

    expect(launched.args).toEqual(
      expect.arrayContaining([
        '--mode',
        'rpc',
        '--approval-mode',
        'always-ask',
        '--cwd',
        'C:\\work\\repo',
      ]),
    );
    for (const flag of [
      '--no-session',
      '--no-skills',
      '--no-extensions',
      '--model',
      'aios/mock-1',
    ]) {
      expect(launched.args).toContain(flag);
    }
    expect(launched.args).not.toContain('--auto-approve');
    expect(launched.args).not.toContain('yolo');
    const promptFile = launched.args[launched.args.indexOf('--append-system-prompt') + 1] ?? '';
    expect(promptFile.startsWith(runDir)).toBe(true);
    expect(await readFile(promptFile, 'utf8')).toBe('# Peran: Uji\nJawab singkat.');
    expect(launched.env.PI_CODING_AGENT_DIR).toBe(join(runDir, 'agent'));
  });

  it('models.yml mengarahkan provider ke proxy lokal dengan kunci lokal, bukan token perangkat', async () => {
    const { handle } = await launchReplay('text-only', { model: 'combo/code' });
    await collect(handle);

    const yaml = await readFile(join(runDir, 'agent', 'models.yml'), 'utf8');
    expect(yaml).toContain('baseUrl: "http://127.0.0.1:4555/v1"');
    expect(yaml).toContain('apiKey: "kunci-lokal"');
    expect(yaml).toContain('- id: "combo/code"');
    expect(yaml).toContain('authHeader: true');
  });

  it('cwd atau runDir kosong ditolak sebelum proses dimulai', async () => {
    const adapter = createOmpAdapter({
      launch: () => {
        throw new Error('tidak boleh dipanggil');
      },
      llm: { baseUrl: 'http://x', apiKey: 'k' },
    });

    await expect(adapter.startRun(input({ cwd: undefined }))).rejects.toMatchObject({
      code: 'omp_config',
    });
    await expect(adapter.startRun(input({ runDir: undefined }))).rejects.toMatchObject({
      code: 'omp_config',
    });
  });
});

describe('transkrip nyata: teks biasa', () => {
  it('delta teks, message.completed, dan run.completed dengan ringkasan dan pemakaian token', async () => {
    const { handle, transport } = await launchReplay('text-only');

    const events = await collect(handle);

    expect(
      events.filter((e) => e.type === 'message.delta').map((e) => (e as { text: string }).text),
    ).toEqual(['Halo ', 'dari ', 'model.']);
    expect(types(events).slice(-2)).toEqual(['message.completed', 'run.completed']);
    expect(events.at(-1)).toEqual({
      type: 'run.completed',
      summary: 'Halo dari model.',
      usage: { inputTokens: 12, outputTokens: 5 },
    });
    expect(
      events.every(
        (e) => e.type !== 'message.delta' || (e as { messageId: string }).messageId === MESSAGE,
      ),
    ).toBe(true);
    // set_auto_retry (mencegah 10x percobaan ulang ke LLM) lalu prompt berisi teks pengguna.
    expect(transport.sent.map((f) => f.type)).toEqual(['set_auto_retry', 'prompt']);
    expect(transport.sent[0]).toMatchObject({ enabled: false });
    expect(transport.sent[1]).toMatchObject({ message: 'kerjakan tugas' });
    expect(transport.mismatches).toEqual([]);
    expect(transport.inputClosed).toBe(true);
  });
});

describe('transkrip nyata: approval', () => {
  it('bash meminta izin dengan perintah persis dan cwd; setelah Izinkan alat berjalan dan run selesai', async () => {
    const { handle, transport } = await launchReplay('tool-approve');

    const events = await collect(handle, async (event) => {
      if (event.type === 'approval.requested')
        await handle.resolveApproval(event.approvalId, 'allow');
    });

    expect(types(events)).toEqual([
      'tool.started',
      'approval.requested',
      'approval.resolved',
      'tool.output',
      'tool.finished',
      'message.delta',
      'message.completed',
      'run.completed',
    ]);
    expect(events[0]).toEqual({
      type: 'tool.started',
      toolCallId: 'call_1',
      name: 'bash',
      target: 'echo hi > probe.txt',
    });
    expect(events[1]).toMatchObject({
      type: 'approval.requested',
      kind: 'command',
      detail: 'echo hi > probe.txt',
      cwd: 'C:\\work\\repo',
      toolCallId: 'call_1',
    });
    expect(events[2]).toMatchObject({
      type: 'approval.resolved',
      decision: 'allow',
      remember: false,
    });
    expect(events[4]).toMatchObject({ type: 'tool.finished', toolCallId: 'call_1', status: 'ok' });
    expect(transport.mismatches).toEqual([]);
    expect(transport.sent.at(-1)).toMatchObject({
      type: 'extension_ui_response',
      value: 'Approve',
    });
  });

  it('Tolak: alat tidak berjalan, status tool denied, dan run tetap selesai', async () => {
    const { handle, transport } = await launchReplay('tool-deny');

    const events = await collect(handle, async (event) => {
      if (event.type === 'approval.requested')
        await handle.resolveApproval(event.approvalId, 'deny');
    });

    expect(events.find((e) => e.type === 'tool.finished')).toMatchObject({ status: 'denied' });
    expect(events.find((e) => e.type === 'approval.resolved')).toMatchObject({ decision: 'deny' });
    expect(events.at(-1)?.type).toBe('run.completed');
    expect(transport.mismatches).toEqual([]);
  });

  it('write meminta izin file_write; "selalu" memakai opsi sesi omp dan izin berikutnya tidak diminta lagi', async () => {
    const { handle, transport } = await launchReplay('write-and-session-approve');

    const events = await collect(handle, async (event) => {
      if (event.type !== 'approval.requested') return;
      await handle.resolveApproval(event.approvalId, 'allow', event.kind === 'command');
    });

    const requests = events.filter((e) => e.type === 'approval.requested');
    expect(requests).toHaveLength(2); // write, bash pertama; bash kedua otomatis di sesi omp
    expect(requests[0]).toMatchObject({
      kind: 'file_write',
      detail: expect.stringContaining('Path: catatan.txt') as unknown,
    });
    expect(requests[1]).toMatchObject({ kind: 'command', detail: 'node --version' });
    const resolved = events.filter((e) => e.type === 'approval.resolved');
    expect(resolved.map((e) => (e as { remember: boolean }).remember)).toEqual([false, true]);
    expect(events.filter((e) => e.type === 'tool.finished')).toHaveLength(3);
    expect(events.find((e) => e.type === 'tool.output')).toMatchObject({ stream: 'stdout' });
    expect(transport.mismatches).toEqual([]);
  });

  it('keluaran tool dikirim sebagai tambahan, bukan teks kumulatif yang berulang', async () => {
    const { handle } = await launchReplay('write-and-session-approve');

    const events = await collect(handle, async (event) => {
      if (event.type === 'approval.requested')
        await handle.resolveApproval(event.approvalId, 'allow', true);
    });

    const nodeOutput = events
      .filter(
        (e) => e.type === 'tool.output' && (e as { toolCallId: string }).toolCallId === 'call_b1',
      )
      .map((e) => (e as { chunk: string }).chunk)
      .join('');
    expect(nodeOutput).toBe('v24.18.0\n');
  });

  it('ID izin tidak dikenal ditolak dengan kode jelas', async () => {
    const { handle } = await launchReplay('text-only');
    await collect(handle);

    await expect(
      handle.resolveApproval('0192f0c4-7a1b-7c2d-9e3f-000000000000', 'allow'),
    ).rejects.toMatchObject({
      code: 'approval_unknown',
    });
  });
});

describe('transkrip nyata: batal, arahkan, galat', () => {
  it('cancel di tengah jawaban mengirim abort dan menutup aliran tanpa run.completed atau error', async () => {
    const { handle, transport } = await launchReplay('abort');

    const events = await collect(handle, async (event) => {
      if (event.type === 'message.delta') await handle.cancel();
    });

    expect(types(events)).toEqual(['message.delta']);
    expect(transport.sent.map((f) => f.type)).toContain('abort');
    expect(transport.mismatches).toEqual([]);
  });

  it('cancel saat izin menggantung menolak izinnya lebih dulu agar abort bisa selesai', async () => {
    const { handle, transport } = await launchReplay('tool-deny');

    const events = await collect(handle, async (event) => {
      if (event.type === 'approval.requested') await handle.cancel();
    });

    expect(events.map((e) => e.type)).toContain('approval.resolved');
    const order = transport.sent.map((f) => f.type);
    expect(order.indexOf('extension_ui_response')).toBeLessThan(order.indexOf('abort'));
  });

  it('steer meneruskan teks arahan ke omp dan jawaban baru tetap mengalir', async () => {
    const { handle, transport } = await launchReplay('steer');

    let steered = false;
    const events = await collect(handle, async (event) => {
      if (event.type === 'message.delta' && !steered) {
        steered = true;
        await handle.steer('fokus ke tes saja');
      }
    });

    expect(transport.sent.find((f) => f.type === 'steer')).toMatchObject({
      message: 'fokus ke tes saja',
    });
    expect(events.at(-1)?.type).toBe('run.completed');
    expect(transport.mismatches).toEqual([]);
  });

  it('galat model (HTTP 500) menjadi event error dengan kode model_http_500, tanpa run.completed', async () => {
    const { handle } = await launchReplay('model-error');

    const events = await collect(handle);

    expect(events).toEqual([
      { type: 'error', code: 'model_http_500', message: '500 boom dari model', retryable: true },
    ]);
  });

  it('steer setelah run selesai ditolak', async () => {
    const { handle } = await launchReplay('text-only');
    await collect(handle);

    await expect(handle.steer('terlambat')).rejects.toBeInstanceOf(AdapterError);
  });
});

function manualTransport(): OmpTransport & {
  queue: AsyncQueue<string>;
  exit: (code: number) => void;
  killed: boolean;
} {
  const queue = new AsyncQueue<string>();
  let resolveExit: (v: { code: number | null }) => void = () => undefined;
  const exited = new Promise<{ code: number | null }>((r) => (resolveExit = r));
  const t = {
    queue,
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
    exit: (code: number) => {
      queue.end();
      resolveExit({ code });
    },
  };
  return t;
}

describe('kegagalan proses', () => {
  const adapterWith = (transport: OmpTransport, readyTimeoutMs = 5000) =>
    createOmpAdapter({
      launch: () => transport,
      llm: { baseUrl: 'http://x', apiKey: 'k' },
      readyTimeoutMs,
      abortGraceMs: 100,
    });

  it('omp mati sebelum selesai: error omp_exited yang bisa dicoba ulang', async () => {
    const transport = manualTransport();
    const handle = await adapterWith(transport).startRun(input());
    transport.queue.push(JSON.stringify({ type: 'ready' }));
    transport.exit(3);

    expect(await collect(handle)).toEqual([
      {
        type: 'error',
        code: 'omp_exited',
        message: 'omp berhenti tiba-tiba (kode 3).',
        retryable: true,
      },
    ]);
  });

  it('tidak pernah siap dalam batas waktu: error omp_not_ready dan proses dimatikan', async () => {
    const transport = manualTransport();
    const handle = await adapterWith(transport, 30).startRun(input());

    const events = await collect(handle);

    expect(events).toEqual([
      {
        type: 'error',
        code: 'omp_not_ready',
        message: 'omp tidak siap dalam batas waktu.',
        retryable: true,
      },
    ]);
    await new Promise((r) => setTimeout(r, 2100));
    expect(transport.killed).toBe(true);
  }, 10_000);

  it('baris non-JSON dan frame tak dikenal diabaikan tanpa merusak aliran', async () => {
    const transport = manualTransport();
    const handle = await adapterWith(transport).startRun(input());
    transport.queue.push('peringatan bukan json');
    transport.queue.push(JSON.stringify({ type: 'ready' }));
    transport.queue.push(JSON.stringify({ type: 'frame_masa_depan', x: 1 }));
    transport.queue.push(JSON.stringify({ type: 'prompt_result', status: 'completed' }));

    const events = await collect(handle);

    expect(types(events)).toEqual(['message.completed', 'run.completed']);
  });

  it('cancel yang tidak dijawab omp mematikan prosesnya setelah masa tunggu', async () => {
    const transport = manualTransport();
    const handle = await adapterWith(transport).startRun(input());
    transport.queue.push(JSON.stringify({ type: 'ready' }));

    await handle.cancel();

    expect(transport.killed).toBe(true);
  });
});

describe('pickOption', () => {
  const options = ['Approve', 'Approve bash for this session', 'Deny'];

  it('memetakan keputusan ke teks opsi dari request', () => {
    expect(pickOption(options, 'allow', false)).toEqual({ value: 'Approve', remembered: false });
    expect(pickOption(options, 'allow', true)).toEqual({
      value: 'Approve bash for this session',
      remembered: true,
    });
    expect(pickOption(options, 'deny', true)).toEqual({ value: 'Deny', remembered: false });
  });

  it('tanpa opsi sesi, "selalu" turun menjadi izinkan sekali; opsi yang hilang menghasilkan undefined', () => {
    expect(pickOption(['Approve', 'Deny'], 'allow', true)).toEqual({
      value: 'Approve',
      remembered: false,
    });
    expect(pickOption(['Approve'], 'deny', false)).toBeUndefined();
    expect(pickOption([], 'allow', false)).toBeUndefined();
  });
});
