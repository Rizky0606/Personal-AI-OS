import { SkillDetailSchema, SkillListSchema } from '@aios/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createAuthEnv, type AuthEnv } from '../../testing/auth-env.js';

let env: AuthEnv;
let appToken: string;
let workerToken: string;

beforeAll(async () => {
  env = await createAuthEnv(inject('testDatabaseUrl'));
  appToken = (await env.loginOk({ kind: 'desktop' })).accessToken;
  workerToken = (await env.loginOk({ kind: 'worker' })).accessToken;
});
afterAll(async () => {
  await env.close();
});

describe('GET /skills', () => {
  it('butuh login; scope app atau worker lolos, llm (tidak ada) tidak', async () => {
    expect((await env.get('/skills')).statusCode).toBe(401);
    expect((await env.get('/skills', appToken)).statusCode).toBe(200);
    expect((await env.get('/skills', workerToken)).statusCode).toBe(200);
  });

  it('mengembalikan indeks tanpa isi: id, name, description, version, source builtin, checksum', async () => {
    const res = await env.get('/skills', appToken);
    const { items } = SkillListSchema.parse(res.json());
    expect(items.length).toBeGreaterThanOrEqual(27);
    const scopeGuard = items.find((s) => s.id === 'scope-guard')!;
    expect(scopeGuard).toMatchObject({ id: 'scope-guard', name: 'scope-guard', source: 'builtin' });
    expect(scopeGuard.version).toBe('1');
    expect(scopeGuard.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(scopeGuard.description.length).toBeLessThanOrEqual(200);
    // Indeks tidak membawa isi skill.
    expect(JSON.stringify(items)).not.toContain('Kerjakan permintaan pengguna sebaik mungkin');
  });

  it('terurut menurut id', async () => {
    const { items } = SkillListSchema.parse((await env.get('/skills', appToken)).json());
    const ids = items.map((s) => s.id);
    expect(ids).toEqual([...ids].sort());
  });
});

describe('GET /skills/:id', () => {
  it('404 untuk skill yang tidak ada', async () => {
    const res = await env.get('/skills/skill-hantu', appToken);
    expect(res.statusCode).toBe(404);
    expect(res.json<{ code: string }>().code).toBe('skill_not_found');
  });

  it('skill nyata: isi lengkap, checksum sama dengan yang di indeks, worker boleh baca', async () => {
    const indexed = SkillListSchema.parse((await env.get('/skills', appToken)).json()).items.find(
      (s) => s.id === 'rich-answers',
    )!;
    const res = await env.get('/skills/rich-answers', workerToken);
    expect(res.statusCode).toBe(200);
    const detail = SkillDetailSchema.parse(res.json());
    expect(detail.checksum).toBe(indexed.checksum);
    expect(detail.body.length).toBeGreaterThan(10);
    expect(detail.body).toContain('aios-ui');
  });

  it('checksum berubah hanya bila isi (body) berubah, tidak oleh metadata', async () => {
    const a = SkillDetailSchema.parse((await env.get('/skills/clarify-once', appToken)).json());
    const b = SkillDetailSchema.parse((await env.get('/skills/clarify-once', appToken)).json());
    expect(a.checksum).toBe(b.checksum);
    expect(a.checksum).not.toBe(
      SkillDetailSchema.parse((await env.get('/skills/scope-guard', appToken)).json()).checksum,
    );
  });
});
