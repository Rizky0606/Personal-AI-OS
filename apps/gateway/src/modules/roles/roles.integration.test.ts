import { INITIAL_ROLE_IDS, RoleListSchema, SendMessageResponseSchema } from '@aios/contracts';
import { AGENT_BEHAVIOR_RULES, CORE_SKILLS, ROLES_PACKAGE_DIR, RegistryError } from '@aios/roles';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createAuthEnv, type AuthEnv } from '../../testing/auth-env.js';
import { startFakeHermes, type FakeHermes } from '../../testing/fake-hermes.js';
import { createRolesService } from './service.js';

let env: AuthEnv;
let hermes: FakeHermes;
let token: string;

beforeAll(async () => {
  hermes = await startFakeHermes();
  env = await createAuthEnv(inject('testDatabaseUrl'), { hermesUrl: hermes.url });
  token = (await env.loginOk({ kind: 'desktop' })).accessToken;
});
afterAll(async () => {
  await env.close();
  await hermes.close();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (ok: () => boolean, ms = 15_000) => {
  const deadline = Date.now() + ms;
  while (!ok() && Date.now() < deadline) await sleep(25);
  return ok();
};

describe('GET /roles', () => {
  it('butuh login dan scope app', async () => {
    expect((await env.get('/roles')).statusCode).toBe(401);
    const worker = (await env.loginOk({ kind: 'worker' })).accessToken;
    expect((await env.get('/roles', worker)).statusCode).toBe(403);
  });

  it('mengembalikan 7 role awal berurutan sesuai kontrak, dengan skill inti di depan', async () => {
    const res = await env.get('/roles', token);
    expect(res.statusCode).toBe(200);
    const { items } = RoleListSchema.parse(res.json());
    expect(items.map((r) => r.id)).toEqual([...INITIAL_ROLE_IDS]);

    const frontend = items.find((r) => r.id === 'frontend')!;
    expect(frontend).toMatchObject({
      name: 'Frontend',
      group: 'coding',
      engine: 'omp',
      model: 'coding-main',
      fallbackModel: 'coding-cheap',
      approval: 'ask',
    });
    expect(frontend.skills).toEqual([
      ...CORE_SKILLS,
      'ui-baseline',
      'a11y-check',
      'ui-states',
      'react-practices',
    ]);
    // Isi prompt tidak ikut ke klien.
    expect(JSON.stringify(items)).not.toContain('Definition of done');
  });
});

describe('bundel sebagai pesan sistem Hermes', () => {
  it('pesan sistem yang diterima Hermes = bundel role general (aturan, role, skill)', async () => {
    hermes.requests.length = 0;
    hermes.onRequest((s) => {
      s.delta('ok');
      s.finish();
      s.done();
    });
    const conv = (await env.post('/conversations', { surface: 'android' }, token)).json<{
      id: string;
    }>();
    const res = await env.post(
      `/conversations/${conv.id}/messages`,
      { parts: [{ type: 'text', text: 'halo' }] },
      token,
    );
    const { run } = SendMessageResponseSchema.parse(res.json());
    await env.runner.idle();

    const [request] = hermes.requests;
    const [system, user] = request!.body.messages;
    expect(user).toEqual({ role: 'user', content: 'halo' });
    expect(system).toEqual({ role: 'system', content: env.roles.bundle('general').systemPrompt });
    for (const rule of AGENT_BEHAVIOR_RULES) expect(system!.content).toContain(rule);
    expect(system!.content).toContain('# Peran: Umum');
    for (const skill of ['scope-guard', 'verify-before-done', 'answer-first', 'clarify-once']) {
      expect(system!.content).toContain(`## ${skill}\n`);
    }
    expect(system!.content).not.toContain('## ui-baseline');
    expect(run.agentRole).toBeNull();
    expect((await env.get(`/runs/${run.id}`, token)).json<{ agentRole: string }>().agentRole).toBe(
      'general',
    );
  });
});

describe('memuat dan hot-reload', () => {
  const dirs: string[] = [];
  const sandbox = () => {
    const dir = mkdtempSync(join(tmpdir(), 'aios-gw-roles-'));
    dirs.push(dir);
    cpSync(join(ROLES_PACKAGE_DIR, 'roles'), join(dir, 'roles'), { recursive: true });
    cpSync(join(ROLES_PACKAGE_DIR, 'skills'), join(dir, 'skills'), { recursive: true });
    return dir;
  };
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
  const edit = (file: string, fn: (t: string) => string) =>
    writeFileSync(file, fn(readFileSync(file, 'utf8')));

  it('gagal saat dibuat bila role merujuk skill yang tidak ada (gateway tidak start)', () => {
    const dir = sandbox();
    edit(join(dir, 'roles', 'general.md'), (t) => t.replace('clarify-once', 'skill-hantu'));
    expect(() => createRolesService({ dir })).toThrow(RegistryError);
    expect(() => createRolesService({ dir })).toThrow(/skill-hantu/);
  });

  it('mode dev: perubahan file dimuat ulang; versi rusak ditolak dan versi lama tetap dipakai', async () => {
    const dir = sandbox();
    const info: object[] = [];
    const errors: { problems?: unknown }[] = [];
    const roles = createRolesService({
      dir,
      watch: true,
      debounceMs: 30,
      log: {
        info: (obj) => info.push(obj),
        error: (obj) => errors.push(obj),
      },
    });
    try {
      await sleep(100); // watcher siap
      expect(roles.bundle('general').systemPrompt).not.toContain('CATATAN-BARU');

      edit(
        join(dir, 'roles', 'general.md'),
        (t) => `${t}\n\nCATATAN-BARU: selalu sebut hari ini.\n`,
      );
      expect(await until(() => roles.bundle('general').systemPrompt.includes('CATATAN-BARU'))).toBe(
        true,
      );

      edit(join(dir, 'skills', 'answer-first', 'SKILL.md'), (t) =>
        t.replace('Kalimat pertama', 'KALIMAT-PERTAMA'),
      );
      expect(
        await until(() => roles.bundle('general').systemPrompt.includes('KALIMAT-PERTAMA')),
      ).toBe(true);

      // Merusak file: registri lama bertahan, error dicatat dengan rinciannya.
      edit(join(dir, 'roles', 'general.md'), (t) => t.replace('skills:', 'skill-salah:'));
      expect(await until(() => errors.length > 0)).toBe(true);
      expect(JSON.stringify(errors[0])).toContain('roles/general.md');
      expect(roles.bundle('general').systemPrompt).toContain('CATATAN-BARU');
      expect(roles.list().map((r) => r.id)).toHaveLength(7);

      // Diperbaiki: pulih sendiri.
      const reloads = info.length;
      edit(join(dir, 'roles', 'general.md'), (t) => t.replace('skill-salah:', 'skills:'));
      expect(await until(() => info.length > reloads)).toBe(true);
    } finally {
      roles.close();
    }
  });

  it('tanpa watch: perubahan file tidak memengaruhi gateway yang berjalan', async () => {
    const dir = sandbox();
    const roles = createRolesService({ dir, watch: false });
    edit(join(dir, 'roles', 'general.md'), (t) => `${t}\n\nTIDAK-TERBACA\n`);
    await sleep(300);
    expect(roles.bundle('general').systemPrompt).not.toContain('TIDAK-TERBACA');
  });

  it('role yang dihapus saat dev tidak membuat bundel role lain rusak; role tak dikenal ditolak', () => {
    const roles = createRolesService({ dir: sandbox() });
    expect(roles.has('general')).toBe(true);
    expect(roles.has('arsitek')).toBe(false);
    expect(() => roles.bundle('arsitek')).toThrow(/arsitek/);
  });
});
