import { AgentEventSchema, type AgentEvent } from '@aios/contracts';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { normalizeEvents } from './events.js';
import { createHermesAdapter, type HermesAdapterOptions } from './hermes.js';
import { parseSse } from './sse.js';

const MESSAGE_ID = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';
const RUN_ID = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8ea0';

interface Seen {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: Record<string, unknown>;
}

async function drain<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

const servers: { close(): void }[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

async function mockHermes(
  handler: (req: IncomingMessage, res: ServerResponse, seen: Seen) => void | Promise<void>,
): Promise<{ url: string; seen: Seen[] }> {
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const entry: Seen = {
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
      };
      seen.push(entry);
      void handler(req, res, entry);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  servers.push({
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  });
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}

const chunk = (delta: object, finish: string | null = null) =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

const sseHead = (res: ServerResponse) =>
  res.writeHead(200, { 'content-type': 'text/event-stream' });

async function collect(
  opts: Partial<HermesAdapterOptions> & { baseUrl: string },
  input: Partial<Parameters<ReturnType<typeof createHermesAdapter>['startRun']>[0]> = {},
): Promise<AgentEvent[]> {
  const handle = await createHermesAdapter(opts).startRun({
    runId: RUN_ID,
    messageId: MESSAGE_ID,
    prompt: 'halo',
    ...input,
  });
  const out: AgentEvent[] = [];
  for await (const e of handle.events) out.push(e);
  return out;
}

describe('adapter Hermes: permintaan', () => {
  it('mengirim sesi, kunci, system prompt, dan pesan user ke /v1/chat/completions', async () => {
    const hermes = await mockHermes((_req, res) => {
      sseHead(res);
      res.end(`${chunk({ content: 'hai' }, 'stop')}data: [DONE]\n\n`);
    });
    await collect(
      { baseUrl: `${hermes.url}/`, apiKey: 'kunci-hermes', sessionKey: 'owner' },
      { sessionId: 'aios-sesi-1', systemPrompt: 'Kamu asisten.', prompt: 'Apa kabar?' },
    );
    const [req] = hermes.seen;
    expect(req).toMatchObject({ method: 'POST', url: '/v1/chat/completions' });
    expect(req!.headers).toMatchObject({
      authorization: 'Bearer kunci-hermes',
      'x-hermes-session-id': 'aios-sesi-1',
      'x-hermes-session-key': 'owner',
    });
    expect(req!.body).toMatchObject({
      stream: true,
      messages: [
        { role: 'system', content: 'Kamu asisten.' },
        { role: 'user', content: 'Apa kabar?' },
      ],
    });
  });

  it('riwayat (sesi baru setelah percakapan dipotong) dikirim di antara system prompt dan pesan baru', async () => {
    const hermes = await mockHermes((_req, res) => {
      sseHead(res);
      res.end(`${chunk({ content: 'x' }, 'stop')}data: [DONE]\n\n`);
    });
    await collect(
      { baseUrl: hermes.url },
      {
        systemPrompt: 'Kamu asisten.',
        history: [
          { role: 'user', content: 'Nama saya Budi.' },
          { role: 'assistant', content: 'Halo Budi.' },
        ],
        prompt: 'Siapa nama saya?',
      },
    );
    expect(hermes.seen[0]!.body).toMatchObject({
      messages: [
        { role: 'system', content: 'Kamu asisten.' },
        { role: 'user', content: 'Nama saya Budi.' },
        { role: 'assistant', content: 'Halo Budi.' },
        { role: 'user', content: 'Siapa nama saya?' },
      ],
    });
  });

  it('tanpa sessionId dan apiKey, header itu tidak dikirim', async () => {
    const hermes = await mockHermes((_req, res) => {
      sseHead(res);
      res.end(`${chunk({ content: 'x' }, 'stop')}data: [DONE]\n\n`);
    });
    await collect({ baseUrl: hermes.url });
    expect(hermes.seen[0]!.headers.authorization).toBeUndefined();
    expect(hermes.seen[0]!.headers['x-hermes-session-id']).toBeUndefined();
  });
});

describe('adapter Hermes: mapping ke AgentEvent', () => {
  it('delta teks, penalaran, usage, lalu message.completed dan run.completed; semua lolos skema', async () => {
    const hermes = await mockHermes((_req, res) => {
      sseHead(res);
      res.write(': keepalive\n\n');
      res.write('event: hermes.tool.progress\ndata: {"tool":"web_search"}\n\n');
      res.write(chunk({ role: 'assistant', reasoning_content: 'mikir' }));
      res.write(chunk({ content: 'Halo ' }));
      res.write(chunk({ content: 'dunia' }, 'stop'));
      res.write(
        `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 8, completion_tokens: 3, completion_tokens_details: { reasoning_tokens: 1 } } })}\n\n`,
      );
      res.end('data: [DONE]\n\n');
    });
    let t = 1_000;
    const events = await collect({ baseUrl: hermes.url, now: () => (t += 250) });
    const usage = { inputTokens: 8, outputTokens: 3, reasoningTokens: 1 };
    expect(events).toEqual([
      // Event awal tanpa ID dari Hermes: adapter memberi ID dan menutupnya ok saat jawaban selesai.
      { type: 'tool.started', toolCallId: 'hermes-tool-1', name: 'web_search' },
      { type: 'reasoning.delta', messageId: MESSAGE_ID, text: 'mikir' },
      { type: 'message.delta', messageId: MESSAGE_ID, text: 'Halo ' },
      { type: 'message.delta', messageId: MESSAGE_ID, text: 'dunia' },
      { type: 'tool.finished', toolCallId: 'hermes-tool-1', status: 'ok', durationMs: 250 },
      { type: 'message.completed', messageId: MESSAGE_ID, usage },
      { type: 'run.completed', summary: 'Halo dunia', usage },
    ]);
    for (const e of events) expect(AgentEventSchema.safeParse(e).success).toBe(true);
  });

  it('event bernama, JSON rusak, dan bentuk chunk tak dikenal diabaikan: tidak ada event error, jawaban tetap selesai', async () => {
    const hermes = await mockHermes((_req, res) => {
      sseHead(res);
      res.write('event: hermes.event_masa_depan\ndata: {"x":1}\n\n');
      res.write('event: hermes.tool.progress\ndata: bukan json\n\n');
      res.write('data: bukan json\n\n');
      res.write('data: [1,2,3]\n\n');
      res.write('data: {"choices":"bukan array"}\n\n');
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ id: 'x' }] } }] })}\n\n`,
      );
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 123 } }] })}\n\n`);
      res.write(chunk({ content: 'ok' }, 'stop'));
      res.end('data: [DONE]\n\n');
    });

    const events = await collect({ baseUrl: hermes.url });

    expect(events.map((e) => e.type)).toEqual([
      'message.delta',
      'message.completed',
      'run.completed',
    ]);
  });

  it('chunk SSE terpotong di tengah baris dan CRLF tetap terbaca utuh', async () => {
    const payload =
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'abc' } }] })}\r\n\r\n` +
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\r\n\r\n` +
      'data: [DONE]\r\n\r\n';
    const hermes = await mockHermes(async (_req, res) => {
      sseHead(res);
      for (let i = 0; i < payload.length; i += 5) {
        res.write(payload.slice(i, i + 5));
        await new Promise((r) => setTimeout(r, 1));
      }
      res.end();
    });
    const events = await collect({ baseUrl: hermes.url });
    expect(events.map((e) => e.type)).toEqual([
      'message.delta',
      'message.completed',
      'run.completed',
    ]);
  });

  it('[DONE] tanpa finish_reason tetap dianggap selesai; tanpa keduanya: terputus (retryable)', async () => {
    const ok = await mockHermes((_req, res) => {
      sseHead(res);
      res.end(`${chunk({ content: 'x' })}data: [DONE]\n\n`);
    });
    expect((await collect({ baseUrl: ok.url })).at(-1)?.type).toBe('run.completed');

    const cut = await mockHermes((_req, res) => {
      sseHead(res);
      res.end(chunk({ content: 'x' }));
    });
    expect((await collect({ baseUrl: cut.url })).at(-1)).toMatchObject({
      type: 'error',
      code: 'hermes_stream_truncated',
      retryable: true,
    });
  });

  it('finish_reason error atau cancelled dari Hermes menjadi event error, bukan sukses', async () => {
    for (const [finish, code] of [
      ['error', 'hermes_error'],
      ['cancelled', 'hermes_cancelled'],
    ] as const) {
      const hermes = await mockHermes((_req, res) => {
        sseHead(res);
        res.end(`${chunk({ content: 'x' }, finish)}data: [DONE]\n\n`);
      });
      const events = await collect({ baseUrl: hermes.url });
      expect(events.at(-1), finish).toMatchObject({ type: 'error', code });
      expect(events.map((e) => e.type)).not.toContain('run.completed');
    }
  });
});

describe('adapter Hermes: kegagalan', () => {
  it.each([
    [401, 'hermes_auth', false],
    [409, 'hermes_session_conflict', false],
    [429, 'hermes_busy', true],
    [503, 'hermes_unavailable', true],
    [400, 'hermes_rejected', false],
  ])('HTTP %i menjadi error %s (retryable=%s)', async (status, code, retryable) => {
    const hermes = await mockHermes((_req, res) => {
      res
        .writeHead(status, { 'content-type': 'application/json' })
        .end('{"error":"rahasia-detail"}');
    });
    const events = await collect({ baseUrl: hermes.url });
    expect(events).toEqual([expect.objectContaining({ type: 'error', code, retryable })]);
    expect(JSON.stringify(events)).not.toContain('rahasia-detail');
  });

  it('Hermes mati: error hermes_unreachable tanpa membocorkan alamat', async () => {
    const dead = await mockHermes(() => undefined);
    const url = dead.url;
    servers.pop()!.close();
    const events = await collect({ baseUrl: url });
    expect(events).toEqual([
      expect.objectContaining({ code: 'hermes_unreachable', retryable: true }),
    ]);
    expect(JSON.stringify(events)).not.toContain(url);
  });

  it('header tidak datang tepat waktu: hermes_timeout', async () => {
    const slow = await mockHermes(() => undefined);
    const events = await collect({ baseUrl: slow.url, connectTimeoutMs: 40 });
    expect(events).toEqual([expect.objectContaining({ code: 'hermes_timeout' })]);
  });

  it('stream diam melewati batas idle: hermes_stalled', async () => {
    const hermes = await mockHermes((_req, res) => {
      sseHead(res);
      res.write(chunk({ content: 'sebagian' }));
    });
    const events = await collect({ baseUrl: hermes.url, idleTimeoutMs: 60 });
    expect(events.map((e) => e.type)).toEqual(['message.delta', 'error']);
    expect(events[1]).toMatchObject({ code: 'hermes_stalled', retryable: true });
  });
});

/**
 * Pemetaan hermes.tool.progress. BENTUK PAYLOAD DI SINI DARI ISSUE NousResearch/hermes-agent#16588 DAN
 * DOKUMENTASI, BUKAN REKAMAN NYATA (belum ada tangkapan Hermes; lihat docs/ADAPTER_EVENTS.md). Tes ini
 * mengunci perilaku adapter terhadap bentuk itu; rekaman nyata dibandingkan lewat hermes.replay.test.ts.
 */
describe('adapter Hermes: hermes.tool.progress → tool.*', () => {
  const progress = (payload: object) =>
    `event: hermes.tool.progress\ndata: ${JSON.stringify(payload)}\n\n`;
  const clockOpts = () => {
    let t = 1_000;
    return { now: () => (t += 250) };
  };

  it('running lalu completed dengan toolCallId yang sama: tool.started, tool.output, tool.finished ok dengan durasi dari selisih waktu', async () => {
    const hermes = await mockHermes((_req, res) => {
      sseHead(res);
      res.write(
        progress({
          toolCallId: 'call_t1',
          tool: 'terminal',
          status: 'running',
          input: { command: 'ls' },
        }),
      );
      res.write(progress({ toolCallId: 'call_t1', tool: 'terminal', status: 'running' }));
      res.write(
        progress({
          toolCallId: 'call_t1',
          tool: 'terminal',
          status: 'completed',
          output: 'a.txt\n',
        }),
      );
      res.write(chunk({ content: 'selesai' }, 'stop'));
      res.end('data: [DONE]\n\n');
    });

    const events = await collect({ baseUrl: hermes.url, ...clockOpts() });

    expect(events.map((e) => e.type)).toEqual([
      'tool.started',
      'tool.output',
      'tool.finished',
      'message.delta',
      'message.completed',
      'run.completed',
    ]);
    expect(events[0]).toEqual({ type: 'tool.started', toolCallId: 'call_t1', name: 'terminal' });
    expect(events[1]).toEqual({
      type: 'tool.output',
      toolCallId: 'call_t1',
      chunk: 'a.txt\n',
      stream: 'stdout',
    });
    // mulai di waktu 1250, selesai di 1500 (jam palsu naik 250 tiap dibaca).
    expect(events[2]).toEqual({
      type: 'tool.finished',
      toolCallId: 'call_t1',
      status: 'ok',
      durationMs: 250,
    });
    for (const e of events) expect(AgentEventSchema.safeParse(e).success).toBe(true);
  });

  it('status gagal menjadi tool.finished error; completed untuk ID yang tak pernah dimulai diabaikan', async () => {
    const hermes = await mockHermes((_req, res) => {
      sseHead(res);
      res.write(progress({ toolCallId: 'call_x', tool: 'terminal', status: 'running' }));
      res.write(progress({ toolCallId: 'call_x', tool: 'terminal', status: 'failed' }));
      res.write(progress({ toolCallId: 'tak-dikenal', tool: 'terminal', status: 'completed' }));
      res.write(chunk({ content: 'ok' }, 'stop'));
      res.end('data: [DONE]\n\n');
    });

    const events = await collect({ baseUrl: hermes.url, ...clockOpts() });

    expect(events.filter((e) => e.type.startsWith('tool.'))).toEqual([
      { type: 'tool.started', toolCallId: 'call_x', name: 'terminal' },
      { type: 'tool.finished', toolCallId: 'call_x', status: 'error', durationMs: 250 },
    ]);
  });

  it('event awal tanpa ID (hanya penanda mulai): ID dibuat adapter, unik per panggilan, dan ditutup ok sebelum jawaban selesai', async () => {
    const hermes = await mockHermes((_req, res) => {
      sseHead(res);
      res.write(progress({ tool: 'web_search', label: 'cari berita' }));
      res.write(progress({ tool: 'web_search', label: 'cari lagi' }));
      res.write(chunk({ content: 'hasil' }, 'stop'));
      res.end('data: [DONE]\n\n');
    });

    const events = await collect({ baseUrl: hermes.url, ...clockOpts() });

    const started = events.filter((e) => e.type === 'tool.started');
    expect(started).toEqual([
      {
        type: 'tool.started',
        toolCallId: 'hermes-tool-1',
        name: 'web_search',
        target: 'cari berita',
      },
      {
        type: 'tool.started',
        toolCallId: 'hermes-tool-2',
        name: 'web_search',
        target: 'cari lagi',
      },
    ]);
    expect(events.map((e) => e.type)).toEqual([
      'tool.started',
      'tool.started',
      'message.delta',
      'tool.finished',
      'tool.finished',
      'message.completed',
      'run.completed',
    ]);
    expect(events.filter((e) => e.type === 'tool.finished')).toEqual([
      { type: 'tool.finished', toolCallId: 'hermes-tool-1', status: 'ok', durationMs: 500 },
      { type: 'tool.finished', toolCallId: 'hermes-tool-2', status: 'ok', durationMs: 500 },
    ]);
  });

  it('cancel saat tool berjalan: tool.finished cancelled, lalu aliran berakhir tanpa error', async () => {
    const hermes = await mockHermes((_req, res) => {
      sseHead(res);
      res.write(progress({ toolCallId: 'call_c', tool: 'terminal', status: 'running' }));
    });
    const handle = await createHermesAdapter({ baseUrl: hermes.url, ...clockOpts() }).startRun({
      runId: RUN_ID,
      messageId: MESSAGE_ID,
      prompt: 'panjang',
    });

    const seen: AgentEvent[] = [];
    for await (const e of handle.events) {
      seen.push(e);
      if (e.type === 'tool.started') await handle.cancel();
    }

    expect(seen).toEqual([
      { type: 'tool.started', toolCallId: 'call_c', name: 'terminal' },
      { type: 'tool.finished', toolCallId: 'call_c', status: 'cancelled', durationMs: 250 },
    ]);
  });

  it('stream putus saat tool berjalan: tool.finished error mendahului event error', async () => {
    const hermes = await mockHermes((_req, res) => {
      sseHead(res);
      res.write(progress({ toolCallId: 'call_d', tool: 'terminal', status: 'running' }), () =>
        res.destroy(),
      );
    });

    const events = await collect({ baseUrl: hermes.url, ...clockOpts() });

    expect(events.map((e) => e.type)).toEqual(['tool.started', 'tool.finished', 'error']);
    expect(events[1]).toMatchObject({ toolCallId: 'call_d', status: 'error' });
  });
});

describe('adapter Hermes: cancel', () => {
  it('cancel di tengah stream menutup koneksi ke Hermes dan mengakhiri events tanpa error', async () => {
    let closed!: () => void;
    const hermesClosed = new Promise<void>((r) => (closed = r));
    const hermes = await mockHermes((_req, res) => {
      sseHead(res);
      res.write(chunk({ content: 'awal' }));
      res.on('close', closed);
    });
    const handle = await createHermesAdapter({ baseUrl: hermes.url }).startRun({
      runId: RUN_ID,
      messageId: MESSAGE_ID,
      prompt: 'panjang',
    });
    const seen: AgentEvent[] = [];
    for await (const e of handle.events) {
      seen.push(e);
      if (e.type === 'message.delta') await handle.cancel();
    }
    expect(seen.map((e) => e.type)).toEqual(['message.delta']);
    await expect(
      Promise.race([
        hermesClosed,
        new Promise((_, rej) =>
          setTimeout(() => rej(new Error('koneksi Hermes tidak ditutup')), 2000),
        ),
      ]),
    ).resolves.toBeUndefined();
  });

  it('cancel sebelum events dibaca, atau signal yang sudah batal: tidak ada panggilan ke Hermes', async () => {
    const hermes = await mockHermes((_req, res) => {
      res.end();
    });
    const adapter = createHermesAdapter({ baseUrl: hermes.url });
    const first = await adapter.startRun({ runId: RUN_ID, messageId: MESSAGE_ID, prompt: 'x' });
    await first.cancel();
    expect(await drain(first.events)).toEqual([]);

    const ctl = new AbortController();
    ctl.abort();
    const second = await adapter.startRun({
      runId: RUN_ID,
      messageId: MESSAGE_ID,
      prompt: 'x',
      signal: ctl.signal,
    });
    expect(await drain(second.events)).toEqual([]);
    expect(hermes.seen).toHaveLength(0);
  });

  it('steer dan approval belum didukung: ditolak dengan kode unsupported', async () => {
    const adapter = createHermesAdapter({ baseUrl: 'http://127.0.0.1:1' });
    const handle = await adapter.startRun({ runId: RUN_ID, messageId: MESSAGE_ID, prompt: 'x' });
    await expect(handle.steer('x')).rejects.toMatchObject({ code: 'unsupported' });
    await expect(handle.resolveApproval('a', 'allow')).rejects.toMatchObject({
      code: 'unsupported',
    });
    expect(adapter.capabilities()).toEqual({
      streaming: true,
      approvals: false,
      steer: false,
      checkpoints: false,
    });
  });
});

describe('helper', () => {
  it('normalizeEvents membuang event yang tidak lolos skema AgentEvent', async () => {
    const invalid: string[] = [];
    async function* source() {
      await Promise.resolve();
      yield { type: 'message.delta', messageId: MESSAGE_ID, text: 'ok' };
      yield { type: 'message.delta', messageId: 'bukan-uuid', text: 'x' };
      yield { type: 'tidak.dikenal' };
    }
    const out = await drain(normalizeEvents(source(), (_raw, issues) => invalid.push(issues)));
    expect(out).toEqual([{ type: 'message.delta', messageId: MESSAGE_ID, text: 'ok' }]);
    expect(invalid).toHaveLength(2);
  });

  it('parseSse: multi-baris data, event bernama, dan event terakhir tanpa baris kosong', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('event: a\ndata: satu\ndata: dua\n\ndata: tiga'));
        c.close();
      },
    });
    expect(await drain(parseSse(body))).toEqual([
      { event: 'a', data: 'satu\ndua' },
      { event: undefined, data: 'tiga' },
    ]);
  });
});
