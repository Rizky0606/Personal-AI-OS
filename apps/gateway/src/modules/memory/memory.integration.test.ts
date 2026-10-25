import {
  ConversationSchema,
  MemoryListSchema,
  MemorySchema,
  ProblemSchema,
  RunSchema,
  SendMessageResponseSchema,
} from '@aios/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { memories } from '../../db/schema/index.js';
import { createAuthEnv, type AuthEnv } from '../../testing/auth-env.js';
import { startFakeHermes, type FakeHermes } from '../../testing/fake-hermes.js';
import { MAX_MEMORIES } from './service.js';

let env: AuthEnv;
let hermes: FakeHermes;
let token: string;

beforeAll(async () => {
  hermes = await startFakeHermes();
  env = await createAuthEnv(inject('testDatabaseUrl'), { hermesUrl: hermes.url });
  token = (await env.loginOk({ kind: 'desktop' })).accessToken;
  hermes.onRequest((s) => {
    s.delta('Siap.');
    s.finish();
    s.done();
  });
});
afterAll(async () => {
  await env.close();
  await hermes.close();
});
beforeEach(async () => {
  hermes.requests.length = 0;
  await env.database.handle.db.delete(memories);
});

const problem = (res: { json(): unknown }) => ProblemSchema.parse(res.json());
const create = async (text: string) => {
  const res = await env.post('/memories', { text }, token);
  expect(res.statusCode, res.body).toBe(201);
  return MemorySchema.parse(res.json());
};
const patch = (id: string, body: object) =>
  env.app.inject({
    method: 'PATCH',
    url: `/v1/memories/${id}`,
    payload: body,
    headers: { authorization: `Bearer ${token}` },
  });
const list = async () => MemoryListSchema.parse((await env.get('/memories', token)).json()).items;

/** Mengirim satu pesan chat dan mengembalikan pesan sistem yang diterima Hermes. */
const systemPromptOfNextRun = async () => {
  const conv = ConversationSchema.parse(
    (await env.post('/conversations', { surface: 'windows' }, token)).json(),
  );
  const sent = SendMessageResponseSchema.parse(
    (
      await env.post(
        `/conversations/${conv.id}/messages`,
        { parts: [{ type: 'text', text: 'Halo' }] },
        token,
      )
    ).json(),
  );
  const deadline = Date.now() + 30_000;
  for (;;) {
    const run = RunSchema.parse((await env.get(`/runs/${sent.run.id}`, token)).json());
    if (['completed', 'failed', 'cancelled'].includes(run.status) || Date.now() > deadline) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  const request = hermes.requests.at(-1);
  return request?.body.messages.find((m) => m.role === 'system')?.content ?? '';
};

describe('memori: CRUD', () => {
  it('tambah, ubah teks, nonaktifkan, dan hapus; daftar terlama dulu', async () => {
    const a = await create('  Saya memakai Windows 11 dan Android.  ');
    const b = await create('Bahasa utama saya Indonesia.');
    expect(a.text).toBe('Saya memakai Windows 11 dan Android.');
    expect(a.enabled).toBe(true);
    expect((await list()).map((m) => m.id)).toEqual([a.id, b.id]);

    const edited = await patch(a.id, { text: 'Saya memakai Windows 11.', enabled: false });
    expect(edited.statusCode).toBe(200);
    expect(MemorySchema.parse(edited.json())).toMatchObject({
      text: 'Saya memakai Windows 11.',
      enabled: false,
    });

    expect((await env.del(`/memories/${b.id}`, token)).statusCode).toBe(204);
    expect((await list()).map((m) => m.id)).toEqual([a.id]);
  });

  it('validasi: teks kosong atau terlalu panjang 400, patch tanpa isi 400, id tidak ada 404', async () => {
    expect((await env.post('/memories', { text: '   ' }, token)).statusCode).toBe(400);
    expect((await env.post('/memories', { text: 'x'.repeat(501) }, token)).statusCode).toBe(400);
    const m = await create('Fakta');
    expect((await patch(m.id, {})).statusCode).toBe(400);
    const missing = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';
    const res = await patch(missing, { enabled: true });
    expect(res.statusCode).toBe(404);
    expect(problem(res).code).toBe('memory_not_found');
    expect((await env.del(`/memories/${missing}`, token)).statusCode).toBe(404);
  });

  it(`maksimal ${MAX_MEMORIES} memori: berikutnya 409 memory_limit`, async () => {
    await env.database.handle.db
      .insert(memories)
      .values(Array.from({ length: MAX_MEMORIES }, (_, i) => ({ text: `fakta ${i}` })));
    const res = await env.post('/memories', { text: 'satu lagi' }, token);
    expect(res.statusCode).toBe(409);
    expect(problem(res).code).toBe('memory_limit');
  });

  it('tanpa token: 401', async () => {
    expect((await env.get('/memories')).statusCode).toBe(401);
  });
});

describe('memori: disuntik ke pesan sistem', () => {
  it('hanya memori aktif, setelah bundel role, dan perubahan langsung berlaku di run berikutnya', async () => {
    expect(await systemPromptOfNextRun()).not.toContain('# Memori tentang pemilik');

    const on = await create('Nama panggilan saya Oji.');
    const off = await create('Saya tidak suka kopi.');
    expect((await patch(off.id, { enabled: false })).statusCode).toBe(200);

    const prompt = await systemPromptOfNextRun();
    expect(prompt).toContain('# Memori tentang pemilik');
    expect(prompt).toContain('- Nama panggilan saya Oji.');
    expect(prompt).not.toContain('kopi');
    // Bundel role tetap di depan; memori menyusul.
    expect(prompt.indexOf('# Memori tentang pemilik')).toBeGreaterThan(0);

    expect((await env.del(`/memories/${on.id}`, token)).statusCode).toBe(204);
    expect(await systemPromptOfNextRun()).not.toContain('Oji');
  });
});
