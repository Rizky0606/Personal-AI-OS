import { ProblemSchema, PromptTemplateListSchema, PromptTemplateSchema } from '@aios/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { promptTemplates } from '../../db/schema/index.js';
import { createAuthEnv, type AuthEnv } from '../../testing/auth-env.js';
import { MAX_PROMPT_TEMPLATES } from './service.js';

let env: AuthEnv;
let token: string;

beforeAll(async () => {
  env = await createAuthEnv(inject('testDatabaseUrl'));
  token = (await env.loginOk({ kind: 'desktop' })).accessToken;
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  await env.database.handle.db.delete(promptTemplates);
});

const problem = (res: { json(): unknown }) => ProblemSchema.parse(res.json());
const create = async (name: string, body = 'Ringkas {{topik}}') =>
  env.post('/prompt-templates', { name, body }, token);
const created = async (name: string, body?: string) => {
  const res = await create(name, body);
  expect(res.statusCode, res.body).toBe(201);
  return PromptTemplateSchema.parse(res.json());
};
const patch = (id: string, body: object) =>
  env.app.inject({
    method: 'PATCH',
    url: `/v1/prompt-templates/${id}`,
    payload: body,
    headers: { authorization: `Bearer ${token}` },
  });
const del = (id: string) =>
  env.app.inject({
    method: 'DELETE',
    url: `/v1/prompt-templates/${id}`,
    headers: { authorization: `Bearer ${token}` },
  });
const list = async () =>
  PromptTemplateListSchema.parse((await env.get('/prompt-templates', token)).json()).items;

describe('templat prompt', () => {
  it('membuat, mendaftar urut nama, mengubah, dan menghapus', async () => {
    const b = await created('ringkas-berita');
    await created('a-review', 'Tinjau {{url}}');
    expect((await list()).map((t) => t.name)).toEqual(['a-review', 'ringkas-berita']);

    const res = await patch(b.id, { body: 'Ringkas berita {{topik}} hari ini' });
    expect(res.statusCode).toBe(200);
    expect(PromptTemplateSchema.parse(res.json())).toMatchObject({
      name: 'ringkas-berita',
      body: 'Ringkas berita {{topik}} hari ini',
    });
    expect((await patch(b.id, { name: 'berita' })).statusCode).toBe(200);

    expect((await del(b.id)).statusCode).toBe(204);
    expect((await list()).map((t) => t.name)).toEqual(['a-review']);
  });

  it('nama dinormalkan ke huruf kecil; nama tak sah ditolak 400', async () => {
    expect((await created('Ringkas')).name).toBe('ringkas');
    for (const name of ['pakai spasi', '-awal', 'a/b', '', 'x'.repeat(41)]) {
      expect((await create(name)).statusCode, name).toBe(400);
    }
    expect((await create('ok', '   ')).statusCode).toBe(400);
  });

  it('nama kembar 409, baik saat membuat maupun mengganti nama', async () => {
    await created('dobel');
    const other = await created('lain');
    const again = await create('dobel');
    expect(again.statusCode).toBe(409);
    expect(problem(again).code).toBe('template_name_taken');
    expect((await patch(other.id, { name: 'dobel' })).statusCode).toBe(409);
  });

  it('PATCH kosong 400; tidak ada 404; tanpa token 401', async () => {
    const t = await created('satu');
    expect((await patch(t.id, {})).statusCode).toBe(400);
    const missing = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';
    expect((await patch(missing, { body: 'x' })).statusCode).toBe(404);
    expect((await del(missing)).statusCode).toBe(404);
    expect((await env.get('/prompt-templates')).statusCode).toBe(401);
  });

  it(`maksimal ${MAX_PROMPT_TEMPLATES} templat`, async () => {
    await env.database.handle.db
      .insert(promptTemplates)
      .values(
        Array.from({ length: MAX_PROMPT_TEMPLATES }, (_, i) => ({ name: `t${i}`, body: 'x' })),
      );
    const res = await create('kelebihan');
    expect(res.statusCode).toBe(409);
    expect(problem(res).code).toBe('template_limit');
  });
});
