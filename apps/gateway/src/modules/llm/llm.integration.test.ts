import { ModelListSchema, ProblemSchema, QuotaSchema } from '@aios/contracts';
import { eq } from 'drizzle-orm';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { auditLog, runs } from '../../db/schema/index.js';
import { createAuthEnv, type AuthEnv } from '../../testing/auth-env.js';
import { startMockServer, type MockServer } from '../../testing/mock-server.js';

const GATEWAY_KEY = 'sk-gateway-only';

interface Seen {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
}

let router: MockServer;
let seen: Seen[];
let respond: (req: IncomingMessage, res: ServerResponse, body: string) => void;
let env: AuthEnv;
let llmToken: string;
let appToken: string;

const json = (res: ServerResponse, status: number, body: unknown) =>
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));

const completion = {
  id: 'chatcmpl-1',
  object: 'chat.completion',
  model: 'coding-main',
  choices: [{ index: 0, message: { role: 'assistant', content: 'halo' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 11, completion_tokens: 7 },
};

const sse = (res: ServerResponse) => {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  res.write('data: {"choices":[{"delta":{"content":"ha"}}]}\n\n');
  res.write('data: {"choices":[{"delta":{"content":"lo"}}]}\n\n');
  res.write('data: {"choices":[],"usage":{"prompt_tokens":20,"completion_tokens":5}}\n\n');
  res.end('data: [DONE]\n\n');
};

beforeAll(async () => {
  router = await startMockServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
      respond(req, res, body);
    });
  });
  env = await createAuthEnv(inject('testDatabaseUrl'), {
    ninerouterUrl: `${router.url}/v1`,
    ninerouterKey: GATEWAY_KEY,
    streamIdleMs: 300,
  });
  llmToken = (await env.loginOk({ kind: 'worker', name: 'PC worker' })).accessToken;
  appToken = (await env.loginOk({ kind: 'desktop', name: 'PC app' })).accessToken;
});
afterAll(async () => {
  await env.close();
  await router.close();
});
beforeEach(() => {
  seen = [];
  router.requests.length = 0;
  respond = (_req, res) => json(res, 200, completion);
});

const problem = (res: { json(): unknown }) => ProblemSchema.parse(res.json());
const newRun = async (model = 'coding-main') => {
  const [run] = await env.database.handle.db
    .insert(runs)
    .values({ kind: 'coding', engine: 'omp', model })
    .returning();
  return run!.id;
};
const usageOf = async (id: string) =>
  (await env.database.handle.db.select().from(runs).where(eq(runs.id, id)))[0]?.usage;
/** Pencatatan usage berjalan setelah respons dikirim; tunggu sampai muncul. */
const eventually = async <T>(read: () => Promise<T>, ok: (v: T) => boolean): Promise<T> => {
  for (let i = 0; i < 500; i++) {
    const v = await read();
    if (ok(v)) return v;
    await new Promise((r) => setTimeout(r, 20));
  }
  return read();
};

const chat = (token: string | undefined, payload: object, headers: Record<string, string> = {}) =>
  env.app.inject({
    method: 'POST',
    url: '/llm/v1/chat/completions',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    payload,
  });

describe('proxy /llm/v1: akses', () => {
  it('tanpa token: 401; token app tanpa scope llm: 403; tidak ada panggilan ke 9Router', async () => {
    const none = await chat(undefined, { model: 'x', messages: [] });
    expect(none.statusCode).toBe(401);
    const app = await chat(appToken, { model: 'x', messages: [] });
    expect(app.statusCode).toBe(403);
    expect(problem(app).code).toBe('insufficient_scope');
    expect(seen).toHaveLength(0);
  });

  it('token llm dicabut: langsung 401', async () => {
    const extra = await env.loginOk({ kind: 'worker', name: 'sementara' });
    expect((await chat(extra.accessToken, { model: 'x', messages: [] })).statusCode).toBe(200);
    expect(
      (await env.del(`/devices/${extra.device.id}`, appToken)).statusCode,
      'pencabutan lewat token app',
    ).toBe(204);
    expect((await chat(extra.accessToken, { model: 'x', messages: [] })).statusCode).toBe(401);
  });

  it('metode selain GET/POST ditolak sebelum ke 9Router', async () => {
    const res = await env.app.inject({
      method: 'DELETE',
      url: '/llm/v1/chat/completions',
      headers: { authorization: `Bearer ${llmToken}` },
    });
    expect(res.statusCode).toBe(404);
    expect(seen).toHaveLength(0);
  });
});

describe('proxy /llm/v1: header dan path', () => {
  it('memakai API key gateway; Authorization perangkat dan header sensitif tidak diteruskan', async () => {
    const res = await chat(
      llmToken,
      { model: 'coding-main', messages: [{ role: 'user', content: 'hai' }] },
      {
        cookie: 'sesi=rahasia',
        'x-forwarded-for': '203.0.113.9',
        'x-api-key': 'sk-milik-klien',
        'openai-beta': 'assistants=v2',
      },
    );
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(completion);
    const upstream = seen[0]!;
    expect(upstream.method).toBe('POST');
    expect(upstream.url).toBe('/v1/chat/completions');
    expect(upstream.headers.authorization).toBe(`Bearer ${GATEWAY_KEY}`);
    expect(JSON.stringify(upstream.headers)).not.toContain(llmToken);
    expect(upstream.headers.cookie).toBeUndefined();
    expect(upstream.headers['x-forwarded-for']).toBeUndefined();
    expect(upstream.headers['x-api-key']).toBeUndefined();
    expect(upstream.headers['openai-beta']).toBe('assistants=v2');
    expect(JSON.parse(upstream.body)).toMatchObject({ model: 'coding-main' });
  });

  it('GET /models dan query string diteruskan; path keluar dari /v1 ditolak', async () => {
    respond = (_req, res) => json(res, 200, { object: 'list', data: [] });
    const ok = await env.app.inject({
      method: 'GET',
      url: '/llm/v1/models?limit=5',
      headers: { authorization: `Bearer ${llmToken}` },
    });
    expect(ok.statusCode).toBe(200);
    expect(seen[0]!.url).toBe('/v1/models?limit=5');

    seen.length = 0;
    for (const url of [
      '/llm/v1/../api/keys',
      '/llm/v1/%2e%2e/api/keys',
      '/llm/v1/a/%2e%2e/%2e%2e/api',
    ]) {
      const res = await env.app.inject({
        method: 'GET',
        url,
        headers: { authorization: `Bearer ${llmToken}` },
      });
      // Router Fastify bisa menolak lebih dulu (404) atau klien 9Router yang menolak (400); yang wajib: tidak diteruskan.
      expect([400, 404], url).toContain(res.statusCode);
    }
    expect(seen).toHaveLength(0);
  });
});

describe('proxy /llm/v1: respons biasa', () => {
  it('status dan body error dari 9Router diteruskan apa adanya', async () => {
    respond = (_req, res) => json(res, 404, { error: { message: 'No active credentials' } });
    const res = await chat(llmToken, { model: 'x', messages: [] });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { message: 'No active credentials' } });
  });

  it('API key gateway ditolak 9Router: 502 llm_upstream_auth, bukan 401 yang menyesatkan', async () => {
    respond = (_req, res) => json(res, 401, { error: { message: 'Missing API key' } });
    const res = await chat(llmToken, { model: 'x', messages: [] });
    expect(res.statusCode).toBe(502);
    expect(problem(res).code).toBe('llm_upstream_auth');
    expect(res.body).not.toContain('Missing API key');
  });

  it('503 sementara dari 9Router diulang sampai berhasil', async () => {
    let n = 0;
    respond = (_req, res) => (n++ < 1 ? json(res, 503, {}) : json(res, 200, completion));
    expect((await chat(llmToken, { model: 'x', messages: [] })).statusCode).toBe(200);
    expect(seen).toHaveLength(2);
  });

  it('usage dicatat ke run dan bertambah, bukan tertimpa, pada panggilan berikutnya', async () => {
    const run = await newRun();
    const headers = { 'x-aios-run-id': run };
    expect((await chat(llmToken, { model: 'a', messages: [] }, headers)).statusCode).toBe(200);
    expect(
      await eventually(
        () => usageOf(run),
        (u) => u?.inputTokens === 11,
      ),
    ).toEqual({ inputTokens: 11, outputTokens: 7 });

    respond = (_req, res) =>
      json(res, 200, {
        ...completion,
        usage: {
          prompt_tokens: 4,
          completion_tokens: 3,
          completion_tokens_details: { reasoning_tokens: 2 },
        },
      });
    await chat(llmToken, { model: 'a', messages: [] }, headers);
    expect(
      await eventually(
        () => usageOf(run),
        (u) => u?.inputTokens === 15,
      ),
    ).toEqual({ inputTokens: 15, outputTokens: 10, reasoningTokens: 2 });
  });

  it('ID run salah: 400 sebelum ke 9Router; run yang tidak ada: tetap dilayani', async () => {
    const bad = await chat(llmToken, { model: 'a', messages: [] }, { 'x-aios-run-id': 'bukan-id' });
    expect([bad.statusCode, problem(bad).code]).toEqual([400, 'invalid_run_id']);
    expect(seen).toHaveLength(0);

    const missing = await chat(
      llmToken,
      { model: 'a', messages: [] },
      { 'x-aios-run-id': '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f' },
    );
    expect(missing.statusCode).toBe(200);
  });
});

describe('proxy /llm/v1: streaming', () => {
  it('menyalakan stream_options.include_usage, meneruskan SSE utuh, dan mencatat usage dari chunk akhir', async () => {
    respond = (_req, res) => sse(res);
    const run = await newRun();
    const res = await chat(
      llmToken,
      {
        model: 'coding-main',
        stream: true,
        stream_options: { include_obfuscation: false },
        messages: [],
      },
      { 'x-aios-run-id': run },
    );
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.headers['x-accel-buffering']).toBe('no');
    expect(res.body).toBe(
      'data: {"choices":[{"delta":{"content":"ha"}}]}\n\n' +
        'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n' +
        'data: {"choices":[],"usage":{"prompt_tokens":20,"completion_tokens":5}}\n\n' +
        'data: [DONE]\n\n',
    );
    expect(JSON.parse(seen[0]!.body)).toMatchObject({
      stream: true,
      stream_options: { include_obfuscation: false, include_usage: true },
    });
    expect(
      await eventually(
        () => usageOf(run),
        (u) => !!u,
      ),
    ).toEqual({ inputTokens: 20, outputTokens: 5 });
  });

  it('chunk tiba bertahap lewat koneksi nyata (bukan ditahan sampai selesai)', async () => {
    respond = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"n":1}\n\n');
      setTimeout(() => res.end('data: [DONE]\n\n'), 150);
    };
    await env.app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = env.app.server.address() as AddressInfo;
    const arrivals: number[] = [];
    const started = Date.now();
    await new Promise<void>((resolve, reject) => {
      const req = httpRequest(
        {
          port,
          host: '127.0.0.1',
          path: '/llm/v1/chat/completions',
          method: 'POST',
          headers: { authorization: `Bearer ${llmToken}`, 'content-type': 'application/json' },
        },
        (res) => {
          res.on('data', () => arrivals.push(Date.now() - started));
          res.on('end', resolve);
        },
      );
      req.on('error', reject);
      req.end(JSON.stringify({ model: 'x', stream: true, messages: [] }));
    });
    expect(arrivals.length).toBeGreaterThanOrEqual(2);
    expect(arrivals.at(-1)! - arrivals[0]!).toBeGreaterThanOrEqual(100);
  });

  it('klien memutus koneksi: panggilan ke 9Router ikut dihentikan', async () => {
    let upstreamClosed: () => void;
    const closed = new Promise<void>((resolve) => (upstreamClosed = resolve));
    respond = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"n":1}\n\n');
      res.on('close', () => upstreamClosed());
    };
    const { port } = env.app.server.address() as AddressInfo;
    const req = httpRequest({
      port,
      host: '127.0.0.1',
      path: '/llm/v1/chat/completions',
      method: 'POST',
      headers: { authorization: `Bearer ${llmToken}`, 'content-type': 'application/json' },
    });
    req.on('error', () => undefined);
    req.on('response', (res) => res.once('data', () => req.destroy()));
    req.end(JSON.stringify({ model: 'x', stream: true, messages: [] }));
    await expect(
      Promise.race([
        closed,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('9Router tidak dihentikan')), 15_000),
        ),
      ]),
    ).resolves.toBeUndefined();
  });

  it('stream macet melewati batas idle: koneksi diputus dan usage sebagian tetap dicatat', async () => {
    respond = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"choices":[],"usage":{"prompt_tokens":9,"completion_tokens":1}}\n\n');
    };
    const run = await newRun();
    const { port } = env.app.server.address() as AddressInfo;
    const outcome = await new Promise<string>((resolve) => {
      const req = httpRequest(
        {
          port,
          host: '127.0.0.1',
          path: '/llm/v1/chat/completions',
          method: 'POST',
          headers: {
            authorization: `Bearer ${llmToken}`,
            'content-type': 'application/json',
            'x-aios-run-id': run,
          },
        },
        (res) => {
          res.on('data', () => undefined);
          res.on('end', () => resolve('end'));
          res.on('error', () => resolve('error'));
          res.on('close', () => resolve('close'));
        },
      );
      req.on('error', () => resolve('error'));
      req.end(JSON.stringify({ model: 'x', stream: true, messages: [] }));
    });
    expect(['end', 'error', 'close']).toContain(outcome);
    expect(
      await eventually(
        () => usageOf(run),
        (u) => !!u,
      ),
    ).toEqual({ inputTokens: 9, outputTokens: 1 });
  });
});

describe('GET /models dan /quota', () => {
  it('butuh scope app: token llm ditolak 403, tanpa token 401', async () => {
    expect((await env.get('/models')).statusCode).toBe(401);
    expect((await env.get('/models', llmToken)).statusCode).toBe(403);
    expect((await env.get('/quota', llmToken)).statusCode).toBe(403);
  });

  it('mengembalikan model dengan label ramah sesuai kontrak, dan memakai cache', async () => {
    respond = (_req, res) =>
      json(res, 200, {
        object: 'list',
        data: [
          { id: 'aisubs/gpt-6-sol', object: 'model', owned_by: 'aisubs' },
          { id: 'coding-main', object: 'model', owned_by: 'combo' },
        ],
      });
    const first = await env.get('/models', appToken);
    expect(first.statusCode).toBe(200);
    expect(ModelListSchema.parse(first.json()).items).toEqual([
      { id: 'coding-main', label: 'Coding Main', kind: 'combo', ownedBy: 'combo' },
      { id: 'aisubs/gpt-6-sol', label: 'gpt-6-sol (aisubs)', kind: 'model', ownedBy: 'aisubs' },
    ]);
    await env.get('/models', appToken);
    expect(seen.filter((s) => s.url === '/v1/models')).toHaveLength(1);
    expect(seen[0]!.headers.authorization).toBe(`Bearer ${GATEWAY_KEY}`);
  });

  it('9Router tidak terjangkau dan belum ada cache: 502 problem+json', async () => {
    const lonely = await createAuthEnv(inject('testDatabaseUrl'));
    try {
      const token = (await lonely.loginOk({ kind: 'desktop' })).accessToken;
      const res = await lonely.get('/models', token);
      expect(res.statusCode).toBe(502);
      expect(problem(res).code).toBe('llm_upstream_unreachable');
    } finally {
      await lonely.close();
    }
  });

  it('kuota diringkas dari tabel runs: total, per model, per hari (WIB)', async () => {
    const quotaEnv = await createAuthEnv(inject('testDatabaseUrl'));
    try {
      const token = (await quotaEnv.loginOk({ kind: 'desktop' })).accessToken;
      const empty = QuotaSchema.parse((await quotaEnv.get('/quota', token)).json());
      expect(empty).toEqual({
        source: 'runs',
        totals: { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
        byModel: [],
        byDay: [],
      });

      const { db } = quotaEnv.database.handle;
      const at = (iso: string) => new Date(iso);
      await db.insert(runs).values([
        {
          kind: 'coding',
          engine: 'omp',
          model: 'coding-main',
          usage: { inputTokens: 100, outputTokens: 40 },
          createdAt: at('2026-10-21T10:00:00Z'),
        },
        {
          kind: 'coding',
          engine: 'omp',
          model: 'coding-main',
          usage: { inputTokens: 50, outputTokens: 10 },
          // 17:30 UTC = 00:30 WIB hari berikutnya.
          createdAt: at('2026-10-21T17:30:00Z'),
        },
        { kind: 'chat', engine: 'hermes', createdAt: at('2026-10-22T01:00:00Z') },
        {
          kind: 'chat',
          engine: 'hermes',
          model: 'terlalu-lama',
          usage: { inputTokens: 999, outputTokens: 999 },
          createdAt: at('2026-08-01T00:00:00Z'),
        },
      ]);
      const quota = QuotaSchema.parse((await quotaEnv.get('/quota', token)).json());
      expect(quota.source).toBe('runs');
      expect(quota.totals).toEqual({ requests: 3, inputTokens: 150, outputTokens: 50, costUsd: 0 });
      expect(quota.byModel).toEqual([
        { model: '(tidak diketahui)', requests: 1, inputTokens: 0, outputTokens: 0, costUsd: 0 },
        { model: 'coding-main', requests: 2, inputTokens: 150, outputTokens: 50, costUsd: 0 },
      ]);
      expect(quota.byDay).toEqual([
        { date: '2026-10-21', requests: 1, inputTokens: 100, outputTokens: 40, costUsd: 0 },
        { date: '2026-10-22', requests: 2, inputTokens: 50, outputTokens: 10, costUsd: 0 },
      ]);
    } finally {
      await quotaEnv.close();
    }
  });
});

describe('jejak', () => {
  it('panggilan model tidak menulis audit_log (volume tinggi)', async () => {
    const before = (await env.database.handle.db.select().from(auditLog)).length;
    await chat(llmToken, {
      model: 'x',
      messages: [{ role: 'user', content: 'rahasia-percakapan' }],
    });
    expect((await env.database.handle.db.select().from(auditLog)).length).toBe(before);
  });
});
