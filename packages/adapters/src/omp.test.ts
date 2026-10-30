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
        'rpc-ui',
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

  it('server MCP run: mcp.json dan overlay ditulis di folder run (bukan worktree), tool tampil langsung, tunggu koneksi', async () => {
    const { handle, launched } = await launchReplay('text-only', {
      mcpServers: {
        aios_browser: {
          url: 'http://127.0.0.1:5555/mcp/run1',
          headers: { Authorization: 'Bearer t' },
        },
      },
    });
    await collect(handle);

    const mcp = JSON.parse(await readFile(join(runDir, 'agent', 'mcp.json'), 'utf8')) as unknown;
    expect(mcp).toEqual({
      mcpServers: {
        aios_browser: {
          type: 'http',
          url: 'http://127.0.0.1:5555/mcp/run1',
          headers: { Authorization: 'Bearer t' },
        },
      },
    });
    const overlay = launched.args[launched.args.indexOf('--config') + 1] ?? '';
    expect(overlay.startsWith(runDir)).toBe(true);
    expect(await readFile(overlay, 'utf8')).toBe('tools:\n  xdev: false\n');
    expect(launched.env.OMP_MCP_STARTUP_TIMEOUT_MS).toBe('0');
  });

  it('tanpa server MCP: tidak ada mcp.json, overlay, atau perubahan lingkungan', async () => {
    const { handle, launched } = await launchReplay('text-only');
    await collect(handle);

    await expect(readFile(join(runDir, 'agent', 'mcp.json'), 'utf8')).rejects.toThrow();
    expect(launched.args).not.toContain('--config');
    expect(launched.env.OMP_MCP_STARTUP_TIMEOUT_MS).toBeUndefined();
  });

  describe('pertanyaan agent (tool ask)', () => {
    const ASK = {
      type: 'extension_ui_request',
      id: 'ui_9',
      method: 'ask',
      questions: [
        {
          id: 'db',
          question: 'Database mana?',
          options: [{ label: 'Postgres' }, { label: 'SQLite' }],
          recommended: 0,
        },
        { id: 'fitur', question: 'Fitur apa?', options: [{ label: 'Auth' }], multi: true },
      ],
    };

    async function start() {
      const transport = manualTransport();
      const written: Record<string, unknown>[] = [];
      transport.write = (frame: string) =>
        written.push(JSON.parse(frame) as Record<string, unknown>);
      const handle = await createOmpAdapter({
        launch: () => transport,
        llm: { baseUrl: 'http://x', apiKey: 'k' },
        abortGraceMs: 50,
      }).startRun(input());
      const push = (frame: Record<string, unknown>) => transport.queue.push(JSON.stringify(frame));
      return { transport, handle, written, push };
    }

    it('mengaktifkan dialog ask sebelum prompt, meneruskan pertanyaan, dan mengirim jawaban ke omp', async () => {
      const { handle, written, push } = await start();
      push({ type: 'ready' });
      push(ASK);

      const events = await collect(handle, async (event) => {
        if (event.type !== 'question.asked') return;
        await handle.answerQuestion(event.questionId, {
          answers: [
            { id: 'db', selectedOptions: ['SQLite'] },
            { id: 'fitur', selectedOptions: ['Auth'], customInput: 'dan Search' },
          ],
          cancelled: false,
        });
        push({ type: 'prompt_result', status: 'completed' });
      });

      expect(written.slice(0, 3).map((f) => f.type)).toEqual([
        'set_ask_dialog',
        'set_subagent_subscription',
        'set_auto_retry',
      ]);
      expect(written.find((f) => f.type === 'set_ask_dialog')).toMatchObject({ enabled: true });
      const asked = events.find((e) => e.type === 'question.asked');
      expect(asked).toMatchObject({ questions: [{ id: 'db' }, { id: 'fitur', multi: true }] });
      expect(written.find((f) => f.type === 'extension_ui_response')).toEqual({
        type: 'extension_ui_response',
        id: 'ui_9',
        answers: [
          { id: 'db', selectedOptions: ['SQLite'] },
          { id: 'fitur', selectedOptions: ['Auth'], customInput: 'dan Search' },
        ],
      });
      expect(events.find((e) => e.type === 'question.resolved')).toMatchObject({
        cancelled: false,
      });
    });

    it('pertanyaan yang tidak sah dibatalkan ke omp tanpa menampilkannya; jawaban untuk id tak dikenal ditolak', async () => {
      const { handle, written, push } = await start();
      push({ type: 'ready' });
      push({ ...ASK, questions: [{ id: 'x', question: 'q' }] });
      push({ type: 'prompt_result', status: 'completed' });

      const events = await collect(handle);

      expect(events.some((e) => e.type === 'question.asked')).toBe(false);
      expect(written.find((f) => f.type === 'extension_ui_response')).toEqual({
        type: 'extension_ui_response',
        id: 'ui_9',
        cancelled: true,
      });
      await expect(
        handle.answerQuestion('0192f0c4-7a1b-7c2d-9e3f-000000000000', {
          answers: [],
          cancelled: true,
        }),
      ).rejects.toMatchObject({ code: 'question_unknown' });
    });

    it('omp menutup dialog sendiri (cancel) atau run dibatalkan: pertanyaan selesai sebagai dibatalkan', async () => {
      const { handle, written, push } = await start();
      push({ type: 'ready' });
      push(ASK);
      push({ type: 'extension_ui_request', id: 'ui_10', method: 'cancel', targetId: 'ui_9' });
      push({ ...ASK, id: 'ui_11' });

      const seen: string[] = [];
      const collecting = collect(handle, async (event) => {
        if (event.type === 'question.asked') seen.push(event.questionId);
        if (seen.length === 2) await handle.cancel();
      });
      const events = await collecting;

      const resolved = events.filter((e) => e.type === 'question.resolved');
      expect(resolved).toHaveLength(2);
      expect(resolved.every((e) => e.cancelled)).toBe(true);
      expect(written.find((f) => f.type === 'extension_ui_response' && f.id === 'ui_11')).toEqual({
        type: 'extension_ui_response',
        id: 'ui_11',
        cancelled: true,
      });
    });
  });

  it('tool todo yang sukses menjadi event todo.updated berisi seluruh daftar; yang gagal atau berbentuk lain diabaikan', async () => {
    const transport = manualTransport();
    const handle = await createOmpAdapter({
      launch: () => transport,
      llm: { baseUrl: 'http://x', apiKey: 'k' },
      abortGraceMs: 100,
    }).startRun(input());
    const push = (frame: Record<string, unknown>) => transport.queue.push(JSON.stringify(frame));
    const phases = [
      {
        name: 'Tahap',
        tasks: [
          { content: 'Baca kode', status: 'completed' },
          { content: 'Tulis tes', status: 'in_progress' },
          { content: 'ngawur', status: 'tidak-dikenal' },
        ],
      },
    ];
    push({ type: 'ready' });
    push({ type: 'tool_execution_start', toolCallId: 't1', toolName: 'todo', args: {} });
    push({ type: 'tool_execution_end', toolCallId: 't1', result: { details: { phases } } });
    push({ type: 'tool_execution_start', toolCallId: 't2', toolName: 'todo', args: {} });
    push({
      type: 'tool_execution_end',
      toolCallId: 't2',
      isError: true,
      result: { details: { phases: [] } },
    });
    push({ type: 'tool_execution_start', toolCallId: 't3', toolName: 'bash', args: {} });
    push({ type: 'tool_execution_end', toolCallId: 't3', result: { details: { phases } } });
    push({ type: 'prompt_result', status: 'completed' });

    const events = await collect(handle);

    const todos = events.filter((e) => e.type === 'todo.updated');
    expect(todos).toEqual([
      {
        type: 'todo.updated',
        phases: [
          {
            name: 'Tahap',
            tasks: [
              { content: 'Baca kode', status: 'completed' },
              { content: 'Tulis tes', status: 'in_progress' },
            ],
          },
        ],
      },
    ]);
  });

  it('LSP mati secara bawaan (--no-lsp); bila dinyalakan, batas waktu diperpanjang lewat overlay dan digabung dengan overlay MCP', async () => {
    const off = await launchReplay('text-only');
    await collect(off.handle);
    expect(off.launched.args).toContain('--no-lsp');
    expect(off.launched.args).not.toContain('--config');

    const on = await launchReplay('text-only', {
      lsp: true,
      mcpServers: { aios_browser: { url: 'http://127.0.0.1:5555/mcp/run1' } },
    });
    await collect(on.handle);
    expect(on.launched.args).not.toContain('--no-lsp');
    const overlay = on.launched.args[on.launched.args.indexOf('--config') + 1] ?? '';
    expect(await readFile(overlay, 'utf8')).toBe(
      'tools:\n  xdev: false\nlsp:\n  requestTimeout: 60\n',
    );
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
    // set_ask_dialog (tool ask), set_auto_retry (mencegah 10x percobaan ulang ke LLM), lalu prompt berisi teks pengguna.
    expect(transport.sent.map((f) => f.type)).toEqual([
      'set_ask_dialog',
      'set_subagent_subscription',
      'set_auto_retry',
      'prompt',
    ]);
    expect(transport.sent[0]).toMatchObject({ enabled: true });
    expect(transport.sent[1]).toMatchObject({ level: 'progress' });
    expect(transport.sent[2]).toMatchObject({ enabled: false });
    expect(transport.sent[3]).toMatchObject({ message: 'kerjakan tugas' });
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
    expect(events.filter((e) => e.type === 'queue.updated')).toEqual([
      { type: 'queue.updated', steering: ['fokus ke tes saja'], followUp: [] },
      { type: 'queue.updated', steering: [], followUp: [] },
    ]);
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

  it('frame subagent menjadi event subagent.updated hanya saat status atau jumlah tool berubah', async () => {
    const transport = manualTransport();
    const handle = await createOmpAdapter({
      launch: () => transport,
      llm: { baseUrl: 'http://x', apiKey: 'k' },
      abortGraceMs: 100,
    }).startRun(input());
    const push = (frame: Record<string, unknown>) => transport.queue.push(JSON.stringify(frame));
    const progress = (status: string, toolCount: number, extra: Record<string, unknown> = {}) =>
      push({
        type: 'subagent_progress',
        payload: {
          agent: 'task',
          parentToolCallId: 'call_t',
          progress: {
            id: 'Pekerja',
            status,
            assignment: 'Baca a.txt',
            toolCount,
            tokens: 12,
            durationMs: 300,
            recentOutput: ['', 'membaca berkas'],
            ...extra,
          },
        },
      });
    push({ type: 'ready' });
    push({
      type: 'subagent_lifecycle',
      payload: { id: 'Pekerja', agent: 'task', status: 'started' },
    });
    progress('running', 0);
    progress('running', 0); // sama: tidak diulang
    progress('running', 1);
    progress('completed', 1);
    push({
      type: 'subagent_lifecycle',
      payload: { id: 'Pekerja', agent: 'task', status: 'completed' },
    });
    push({ type: 'prompt_result', status: 'completed' });

    const events = (await collect(handle)).filter((e) => e.type === 'subagent.updated');

    expect(events.map((e) => [e.status, e.toolCount])).toEqual([
      ['running', 0],
      ['running', 1],
      ['completed', 1],
    ]);
    expect(events[1]).toMatchObject({
      subagentId: 'Pekerja',
      agent: 'task',
      assignment: 'Baca a.txt',
      tokens: 12,
      lastOutput: 'membaca berkas',
      parentToolCallId: 'call_t',
    });
  });

  it('removeQueued mengirim remove_queued_message dengan nama antrean omp; setelah run selesai ditolak', async () => {
    const transport = manualTransport();
    const written: Record<string, unknown>[] = [];
    transport.write = (frame: string) => written.push(JSON.parse(frame) as Record<string, unknown>);
    const handle = await createOmpAdapter({
      launch: () => transport,
      llm: { baseUrl: 'http://x', apiKey: 'k' },
      abortGraceMs: 100,
    }).startRun(input());

    await handle.removeQueued('followUp', 'lalu lint');
    await handle.removeQueued('steering', 'fokus');

    expect(written.map(({ type, message, queue }) => ({ type, message, queue }))).toEqual([
      { type: 'remove_queued_message', message: 'lalu lint', queue: 'followUp' },
      { type: 'remove_queued_message', message: 'fokus', queue: 'steering' },
    ]);
    transport.kill();
    await collect(handle);
    await expect(handle.removeQueued('steering', 'x')).rejects.toBeInstanceOf(AdapterError);
  });

  it('follow-up memakai frame follow_up (antre sampai giliran selesai), bukan steer', async () => {
    const transport = manualTransport();
    const written: Record<string, unknown>[] = [];
    transport.write = (frame: string) => written.push(JSON.parse(frame) as Record<string, unknown>);
    const handle = await createOmpAdapter({
      launch: () => transport,
      llm: { baseUrl: 'http://x', apiKey: 'k' },
      abortGraceMs: 100,
    }).startRun(input());

    await handle.steer('lalu jalankan lint', 'followUp');
    await handle.steer('fokus ke tes', 'steer');
    await handle.steer('tanpa mode');

    expect(written.map(({ type, message }) => ({ type, message }))).toEqual([
      { type: 'follow_up', message: 'lalu jalankan lint' },
      { type: 'steer', message: 'fokus ke tes' },
      { type: 'steer', message: 'tanpa mode' },
    ]);
    transport.kill();
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

/**
 * Skenario di bawah memakai bentuk frame yang sama dengan rekaman nyata (tool_execution_start/end,
 * prompt_result), tetapi urutannya disusun tangan: rekaman nyata belum memuat tool yang sedang berjalan
 * saat dibatalkan, proses mati saat tool berjalan, atau penalaran (thinking). Lihat docs/ADAPTER_EVENTS.md.
 */
describe('urutan frame sintetis (bentuk frame dari rekaman)', () => {
  const llm = { baseUrl: 'http://x', apiKey: 'k' };
  const frame = (transport: ReturnType<typeof manualTransport>, f: Record<string, unknown>) =>
    transport.queue.push(JSON.stringify(f));
  const toolStart = {
    type: 'tool_execution_start',
    toolCallId: 'call_9',
    toolName: 'bash',
    args: { command: 'sleep 60' },
  };

  async function boot(clock: { t: number }) {
    const transport = manualTransport();
    const adapter = createOmpAdapter({
      launch: () => transport,
      llm,
      now: () => clock.t,
      abortGraceMs: 500,
    });
    const handle = await adapter.startRun(input());
    frame(transport, { type: 'ready' });
    frame(transport, {
      id: 'cfg-retry',
      type: 'response',
      command: 'set_auto_retry',
      success: true,
    });
    return { transport, handle };
  }

  it('cancel saat tool berjalan dan omp tidak mengirim tool_execution_end: tool.finished cancelled lebih dulu, lalu aliran tutup', async () => {
    const clock = { t: 1000 };
    const { transport, handle } = await boot(clock);
    frame(transport, toolStart);

    const events = await collect(handle, async (event) => {
      if (event.type !== 'tool.started') return;
      clock.t = 1750;
      const cancelled = handle.cancel();
      frame(transport, { id: 'p1', type: 'prompt_result', status: 'aborted' });
      await cancelled;
    });

    expect(events).toEqual([
      { type: 'tool.started', toolCallId: 'call_9', name: 'bash', target: 'sleep 60' },
      { type: 'tool.finished', toolCallId: 'call_9', status: 'cancelled', durationMs: 750 },
    ]);
  });

  it('cancel saat tool berjalan dan omp mengirim hasil galat karena dihentikan: tetap cancelled, bukan error', async () => {
    const clock = { t: 1000 };
    const { transport, handle } = await boot(clock);
    frame(transport, toolStart);

    const events = await collect(handle, async (event) => {
      if (event.type !== 'tool.started') return;
      clock.t = 1300;
      const cancelled = handle.cancel();
      frame(transport, {
        type: 'tool_execution_end',
        toolCallId: 'call_9',
        toolName: 'bash',
        result: { content: [{ type: 'text', text: 'Command aborted' }] },
        isError: true,
      });
      frame(transport, { id: 'p1', type: 'prompt_result', status: 'aborted' });
      await cancelled;
    });

    expect(events.map((e) => e.type)).toEqual(['tool.started', 'tool.finished']);
    expect(events[1]).toMatchObject({ status: 'cancelled', durationMs: 300 });
  });

  it('cancel saat izin menggantung (rekaman tool-deny): tool selesai sebagai cancelled, bukan denied', async () => {
    const { handle } = await launchReplay('tool-deny');

    const events = await collect(handle, async (event) => {
      if (event.type === 'approval.requested') await handle.cancel();
    });

    expect(events.find((e) => e.type === 'tool.finished')).toMatchObject({ status: 'cancelled' });
  });

  it('omp mati saat tool berjalan: tool.finished error mendahului event error', async () => {
    const clock = { t: 5000 };
    const { transport, handle } = await boot(clock);
    frame(transport, toolStart);

    const events = await collect(handle, (event) => {
      if (event.type !== 'tool.started') return;
      clock.t = 5400;
      transport.exit(1);
    });

    expect(events.map((e) => e.type)).toEqual(['tool.started', 'tool.finished', 'error']);
    expect(events[1]).toMatchObject({ status: 'error', durationMs: 400 });
  });

  it('penalaran: thinking_delta menjadi reasoning.delta dengan messageId pesan asisten', async () => {
    const { transport, handle } = await boot({ t: 0 });
    frame(transport, {
      type: 'message_update',
      assistantMessageEvent: { type: 'thinking_delta', delta: 'Pertama, baca berkasnya. ' },
    });
    frame(transport, {
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'Selesai.' },
    });
    frame(transport, { id: 'p1', type: 'prompt_result', status: 'completed' });

    const events = await collect(handle);

    expect(events.slice(0, 2)).toEqual([
      { type: 'reasoning.delta', messageId: MESSAGE, text: 'Pertama, baca berkasnya. ' },
      { type: 'message.delta', messageId: MESSAGE, text: 'Selesai.' },
    ]);
  });

  it('frame dan subjenis yang tidak dikenal diabaikan: run tetap selesai dan tidak ada event error', async () => {
    const { transport, handle } = await boot({ t: 0 });
    frame(transport, { type: 'frame_masa_depan', payload: { a: 1 } });
    frame(transport, {
      type: 'message_update',
      assistantMessageEvent: { type: 'jenis_baru', delta: 'x' },
    });
    frame(transport, { type: 'message_update', assistantMessageEvent: 'bukan objek' });
    frame(transport, {
      type: 'tool_execution_update',
      toolCallId: 'tak-pernah-mulai',
      partialResult: {},
    });
    frame(transport, { type: 'tool_execution_end', toolCallId: 'tak-pernah-mulai', result: {} });
    frame(transport, { type: 'extension_ui_request', id: 'u1', method: 'metode_baru' });
    frame(transport, {
      type: 'extension_ui_request',
      id: 'u2',
      method: 'select',
      title: 'Judul lain',
      options: ['a'],
    });
    frame(transport, {
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'ok' },
    });
    frame(transport, { id: 'p1', type: 'prompt_result', status: 'completed' });

    const events = await collect(handle);

    expect(events.map((e) => e.type)).toEqual([
      'message.delta',
      'message.completed',
      'run.completed',
    ]);
  });
});
