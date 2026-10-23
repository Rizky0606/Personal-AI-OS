import { CompareResponseSchema, ProblemSchema } from '@aios/contracts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createAuthEnv, type AuthEnv } from '../../testing/auth-env.js';
import { startMockServer, type MockServer } from '../../testing/mock-server.js';

let router: MockServer;
let env: AuthEnv;
let app: string;
let worker: string;
const bodies: { model: string; messages: { content: string }[]; stream: boolean }[] = [];

const json = (res: ServerResponse, status: number, body: unknown) =>
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));

function answer(req: IncomingMessage, res: ServerResponse) {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as (typeof bodies)[number];
    bodies.push(body);
    if (body.model === 'rusak') return json(res, 500, { error: { message: 'provider mati' } });
    const delay = body.model === 'lambat' ? 150 : 0;
    setTimeout(
      () =>
        json(res, 200, {
          choices: [{ message: { role: 'assistant', content: `jawaban ${body.model}` } }],
          usage: { prompt_tokens: 10, completion_tokens: body.model.length },
        }),
      delay,
    );
  });
}

beforeAll(async () => {
  router = await startMockServer(answer);
  env = await createAuthEnv(inject('testDatabaseUrl'), { ninerouterUrl: `${router.url}/v1` });
  app = (await env.loginOk({ kind: 'desktop' })).accessToken;
  worker = (await env.loginOk({ kind: 'worker' })).accessToken;
});
afterAll(async () => {
  await env.close();
  await router.close();
});

describe('POST /compare', () => {
  it('prompt yang sama ke tiap model, paralel; hasil berurutan sesuai permintaan dengan waktu dan usage', async () => {
    bodies.length = 0;
    const res = await env.post(
      '/compare',
      { prompt: 'jelaskan closure', models: ['lambat', 'cepat'] },
      app,
    );

    expect(res.statusCode, res.body).toBe(200);
    const { results } = CompareResponseSchema.parse(res.json());
    expect(results.map((r) => [r.model, r.ok, r.text])).toEqual([
      ['lambat', true, 'jawaban lambat'],
      ['cepat', true, 'jawaban cepat'],
    ]);
    expect(results[0]?.latencyMs).toBeGreaterThanOrEqual(140);
    expect(results[0]?.usage).toEqual({ inputTokens: 10, outputTokens: 6 });
    expect(bodies.map((b) => [b.model, b.stream, b.messages[0]?.content])).toEqual(
      expect.arrayContaining([
        ['lambat', false, 'jelaskan closure'],
        ['cepat', false, 'jelaskan closure'],
      ]),
    );
  });

  it('satu model gagal: hasil lainnya tetap ada, galatnya tercatat per model', async () => {
    const res = await env.post('/compare', { prompt: 'halo', models: ['rusak', 'cepat'] }, app);

    const { results } = CompareResponseSchema.parse(res.json());
    expect(results[0]).toMatchObject({
      model: 'rusak',
      ok: false,
      error: 'provider mati',
      usage: null,
    });
    expect(results[1]).toMatchObject({ model: 'cepat', ok: true });
  });

  it('validasi: kurang dari 2, lebih dari 3, kembar, dan prompt kosong ditolak 400; scope worker 403', async () => {
    for (const body of [
      { prompt: 'x', models: ['a'] },
      { prompt: 'x', models: ['a', 'b', 'c', 'd'] },
      { prompt: 'x', models: ['a', 'a'] },
      { prompt: '', models: ['a', 'b'] },
    ]) {
      const res = await env.post('/compare', body, app);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(ProblemSchema.parse(res.json()).status).toBe(400);
    }
    expect(
      (await env.post('/compare', { prompt: 'x', models: ['a', 'b'] }, worker)).statusCode,
    ).toBe(403);
    expect((await env.post('/compare', { prompt: 'x', models: ['a', 'b'] })).statusCode).toBe(401);
  });
});
