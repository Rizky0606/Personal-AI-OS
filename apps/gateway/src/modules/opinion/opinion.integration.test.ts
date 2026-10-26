import { OpinionResponseSchema, ProblemSchema } from '@aios/contracts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createAuthEnv, type AuthEnv } from '../../testing/auth-env.js';
import { startMockServer, type MockServer } from '../../testing/mock-server.js';
import { MAX_TOTAL_PATCH_CHARS, OPINION_SYSTEM_PROMPT } from './service.js';

let router: MockServer;
let env: AuthEnv;
let app: string;
const bodies: { model: string; stream: boolean; messages: { role: string; content: string }[] }[] =
  [];
let reply: (model: string) => { status: number; body: unknown } = () => ({ status: 200, body: {} });

const json = (res: ServerResponse, status: number, body: unknown) =>
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));

function answer(req: IncomingMessage, res: ServerResponse) {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as (typeof bodies)[number];
    bodies.push(body);
    const out = reply(body.model);
    json(res, out.status, out.body);
  });
}

const completion = (content: string) => ({
  status: 200,
  body: { choices: [{ message: { role: 'assistant', content } }] },
});

beforeAll(async () => {
  router = await startMockServer(answer);
  env = await createAuthEnv(inject('testDatabaseUrl'), { ninerouterUrl: `${router.url}/v1` });
  app = (await env.loginOk({ kind: 'desktop' })).accessToken;
});
afterAll(async () => {
  await env.close();
  await router.close();
});

const files = [
  { path: 'src/a.ts', patch: '@@ -1,2 +1,3 @@\n a\n+b\n c' },
  { path: 'src/b.ts', patch: '@@ -1 +1 @@\n-x\n+y' },
];

describe('POST /review/opinion', () => {
  it('mengirim diff ke model pilihan dan mengembalikan ringkasan dan temuan per baris', async () => {
    bodies.length = 0;
    reply = () =>
      completion(
        JSON.stringify({
          summary: 'Satu risiko.',
          findings: [
            { path: 'src/a.ts', line: 2, severity: 'warning', body: 'Tidak ada tes.' },
            { path: 'luar.ts', line: 1, severity: 'bug', body: 'diabaikan' },
          ],
        }),
      );
    const res = await env.post('/review/opinion', { model: 'peninjau', files }, app);

    expect(res.statusCode, res.body).toBe(200);
    expect(OpinionResponseSchema.parse(res.json())).toEqual({
      model: 'peninjau',
      summary: 'Satu risiko.',
      findings: [{ path: 'src/a.ts', line: 2, severity: 'warning', body: 'Tidak ada tes.' }],
      truncated: false,
    });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ model: 'peninjau', stream: false });
    expect(bodies[0]?.messages[0]).toEqual({ role: 'system', content: OPINION_SYSTEM_PROMPT });
    expect(bodies[0]?.messages[1]?.content).toContain('### src/a.ts\n@@ -1,2 +1,3 @@');
    expect(bodies[0]?.messages[1]?.content).toContain('### src/b.ts');
  });

  it('diff besar dipotong dan ditandai truncated', async () => {
    bodies.length = 0;
    reply = () => completion('{"summary":"ok","findings":[]}');
    const big = [
      { path: 'besar.ts', patch: 'x'.repeat(MAX_TOTAL_PATCH_CHARS - 10) },
      { path: 'sisa.ts', patch: 'y'.repeat(500) },
      { path: 'tidak-ikut.ts', patch: 'z' },
    ];
    const res = await env.post('/review/opinion', { model: 'm', files: big }, app);
    expect(OpinionResponseSchema.parse(res.json()).truncated).toBe(true);
    const sent = bodies[0]?.messages[1]?.content ?? '';
    expect(sent).toContain('### sisa.ts');
    expect(sent).not.toContain('tidak-ikut.ts');
    expect(sent.length).toBeLessThan(MAX_TOTAL_PATCH_CHARS + 200);
  });

  it('model gagal: 502 opinion_failed dengan pesan dari provider', async () => {
    reply = () => ({ status: 500, body: { error: { message: 'provider mati' } } });
    const res = await env.post('/review/opinion', { model: 'm', files }, app);
    expect(res.statusCode).toBe(502);
    expect(ProblemSchema.parse(res.json())).toMatchObject({ code: 'opinion_failed' });
    expect(res.body).toContain('provider mati');
  });

  it('permintaan tak sah 400; tanpa token 401', async () => {
    expect((await env.post('/review/opinion', { model: 'm', files: [] }, app)).statusCode).toBe(
      400,
    );
    expect((await env.post('/review/opinion', { files }, app)).statusCode).toBe(400);
    expect((await env.post('/review/opinion', { model: 'm', files })).statusCode).toBe(401);
  });
});
