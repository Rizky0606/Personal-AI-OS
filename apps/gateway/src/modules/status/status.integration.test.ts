import { LoginResponseSchema, StatusSchema } from '@aios/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createAuthEnv, type AuthEnv } from '../../testing/auth-env.js';
import { GATEWAY_VERSION } from '../../version.js';

let env: AuthEnv;
let app: string;

beforeAll(async () => {
  env = await createAuthEnv(inject('testDatabaseUrl'), { research: undefined });
  app = (await env.loginOk({ kind: 'desktop' })).accessToken;
});
afterAll(() => env.close());

describe('GET /status', () => {
  it('versi, dependensi, worker terdaftar (offline bila belum tersambung), dan run aktif', async () => {
    const registered = LoginResponseSchema.parse(
      (await env.post('/devices/worker', { name: 'PC kerja' }, app)).json(),
    );

    const res = await env.get('/status', app);

    expect(res.statusCode, res.body).toBe(200);
    const status = StatusSchema.parse(res.json());
    expect(status.gateway).toMatchObject({ version: GATEWAY_VERSION, adaptersVersion: '0.1.0' });
    expect(status.gateway.node).toMatch(/^v\d+/);
    expect(status.readiness.status).toBe('ok');
    expect(status.workers).toHaveLength(1);
    expect(status.workers[0]).toMatchObject({
      deviceId: registered.device.id,
      name: 'PC kerja',
      online: false,
    });
    expect(status.activeRuns).toBe(0);
    expect(status.jobs).toEqual([]);
  });

  it('worker yang dicabut tidak muncul; tanpa token 401', async () => {
    const extra = LoginResponseSchema.parse(
      (await env.post('/devices/worker', { name: 'PC lama' }, app)).json(),
    );
    expect((await env.del(`/devices/${extra.device.id}`, app)).statusCode).toBe(204);

    const status = StatusSchema.parse((await env.get('/status', app)).json());

    expect(status.workers.map((w) => w.name)).not.toContain('PC lama');
    expect((await env.get('/status')).statusCode).toBe(401);
  });
});
