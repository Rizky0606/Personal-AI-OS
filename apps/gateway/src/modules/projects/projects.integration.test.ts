import {
  DeviceListSchema,
  LoginResponseSchema,
  ProblemSchema,
  ProjectSchema,
  TokenPairSchema,
} from '@aios/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { auditLog } from '../../db/schema/index.js';
import { createAuthEnv, type AuthEnv } from '../../testing/auth-env.js';

let env: AuthEnv;
let desktop: string;

beforeAll(async () => {
  env = await createAuthEnv(inject('testDatabaseUrl'));
  desktop = (await env.loginOk({ kind: 'desktop' })).accessToken;
});
afterAll(async () => {
  await env.close();
});

const problem = (res: { json(): unknown }) => ProblemSchema.parse(res.json());
const MISSING = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';
const stack = { languages: ['typescript'], frameworks: ['react'], packageManager: 'pnpm' };

async function registerWorker(name = 'Worker PC', token = desktop) {
  const res = await env.post('/devices/worker', { name }, token);
  expect(res.statusCode, res.body).toBe(201);
  return LoginResponseSchema.parse(res.json());
}

describe('POST /devices/worker', () => {
  it('desktop mendaftarkan worker: perangkat kind worker dengan scope worker dan llm, token langsung bisa dipakai', async () => {
    const worker = await registerWorker('Worker A');

    expect(worker.device).toMatchObject({ kind: 'worker', name: 'Worker A' });
    expect(worker.device.scopes).toEqual(['worker', 'llm']);
    const refreshed = await env.post('/auth/refresh', { refreshToken: worker.refreshToken });
    expect(refreshed.statusCode).toBe(200);
    expect(TokenPairSchema.parse(refreshed.json()).refreshToken).not.toBe(worker.refreshToken);
  });

  it('mendaftar ulang dengan nama sama mencabut worker lama; hanya satu yang aktif', async () => {
    const first = await registerWorker('Worker B');
    const second = await registerWorker('Worker B');

    const oldRefresh = await env.post('/auth/refresh', { refreshToken: first.refreshToken });
    expect(oldRefresh.statusCode).toBe(401);
    const list = DeviceListSchema.parse((await env.get('/devices', desktop)).json());
    const named = list.items.filter((d) => d.name === 'Worker B');
    expect(named.map((d) => d.id)).toEqual([second.device.id]);
  });

  it('token worker atau tanpa token tidak bisa mendaftarkan worker', async () => {
    const worker = await registerWorker('Worker C');

    expect((await env.post('/devices/worker', { name: 'X' }, worker.accessToken)).statusCode).toBe(
      403,
    );
    expect((await env.post('/devices/worker', { name: 'X' })).statusCode).toBe(401);
  });

  it('nama kosong ditolak 400 dan pendaftaran tercatat di audit', async () => {
    expect((await env.post('/devices/worker', { name: '' }, desktop)).statusCode).toBe(400);
    const worker = await registerWorker('Worker D');

    const rows = await env.database.handle.db.select().from(auditLog);
    expect(
      rows.some(
        (r) => r.action === 'worker.registered' && r.target === `device:${worker.device.id}`,
      ),
    ).toBe(true);
  });
});

describe('/projects', () => {
  it('membuat, mendaftar, dan mengubah project atas worker yang aktif', async () => {
    const worker = await registerWorker('Worker P');

    const created = await env.post(
      '/projects',
      { name: 'Aplikasi saya', workerDeviceId: worker.device.id, stack },
      desktop,
    );
    expect(created.statusCode, created.body).toBe(201);
    const project = ProjectSchema.parse(created.json());
    expect(project).toMatchObject({
      name: 'Aplikasi saya',
      workerDeviceId: worker.device.id,
      defaultBranch: 'main',
      stack,
    });

    const list = (await env.get('/projects', desktop)).json<{ items: { id: string }[] }>();
    expect(list.items.map((p) => p.id)).toContain(project.id);

    const patched = await env.app.inject({
      method: 'PATCH',
      url: `/v1/projects/${project.id}`,
      headers: { authorization: `Bearer ${desktop}` },
      payload: { name: 'Nama baru', defaultBranch: 'develop' },
    });
    expect(ProjectSchema.parse(patched.json())).toMatchObject({
      name: 'Nama baru',
      defaultBranch: 'develop',
      stack,
    });
  });

  it('workerDeviceId harus perangkat worker aktif: desktop, tidak ada, dan yang dicabut ditolak 400', async () => {
    const desktopId = (await env.loginOk({ kind: 'desktop', name: 'PC lain' })).device.id;
    const revoked = await registerWorker('Worker Cabut');
    await env.del(`/devices/${revoked.device.id}`, desktop);

    for (const workerDeviceId of [desktopId, MISSING, revoked.device.id]) {
      const res = await env.post('/projects', { name: 'X', workerDeviceId, stack }, desktop);
      expect(res.statusCode).toBe(400);
      expect(problem(res).code).toBe('invalid_worker');
    }
  });

  it('validasi: nama kosong 400; PATCH project tidak ada 404', async () => {
    const worker = await registerWorker('Worker V');

    expect(
      (await env.post('/projects', { name: '', workerDeviceId: worker.device.id, stack }, desktop))
        .statusCode,
    ).toBe(400);
    const patch = await env.app.inject({
      method: 'PATCH',
      url: `/v1/projects/${MISSING}`,
      headers: { authorization: `Bearer ${desktop}` },
      payload: { name: 'x' },
    });
    expect(patch.statusCode).toBe(404);
    expect(problem(patch).code).toBe('project_not_found');
  });

  it('token worker tidak bisa mengakses /projects (scope app); tanpa token 401', async () => {
    const worker = await registerWorker('Worker S');

    expect((await env.get('/projects', worker.accessToken)).statusCode).toBe(403);
    expect((await env.get('/projects')).statusCode).toBe(401);
  });

  it('path folder tidak pernah ada di respons project', async () => {
    const worker = await registerWorker('Worker N');
    const res = await env.post(
      '/projects',
      { name: 'P', workerDeviceId: worker.device.id, stack },
      desktop,
    );

    expect(Object.keys(res.json()).sort()).toEqual(
      [
        'createdAt',
        'defaultBranch',
        'id',
        'instructions',
        'name',
        'stack',
        'updatedAt',
        'workerDeviceId',
      ].sort(),
    );
  });
});
