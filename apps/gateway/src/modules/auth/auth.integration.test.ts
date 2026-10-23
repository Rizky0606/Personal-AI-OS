import { createHash } from 'node:crypto';
import { LoginResponseSchema, ProblemSchema, TokenPairSchema } from '@aios/contracts';
import { eq } from 'drizzle-orm';
import { decodeJwt } from 'jose';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { auditLog, devices } from '../../db/schema/index.js';
import { OWNER_PASSWORD, createAuthEnv, type AuthEnv } from '../../testing/auth-env.js';

const DAY = 24 * 60 * 60 * 1000;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

let env: AuthEnv;
beforeAll(async () => {
  env = await createAuthEnv(inject('testDatabaseUrl'));
});
afterAll(async () => {
  await env.close();
});

const problem = (res: { json(): unknown }) => ProblemSchema.parse(res.json());
const deviceRow = async (id: string) =>
  (await env.database.handle.db.select().from(devices).where(eq(devices.id, id)))[0];
const audits = async (action: string) =>
  env.database.handle.db.select().from(auditLog).where(eq(auditLog.action, action));
const refresh = (refreshToken: string) => env.post('/auth/refresh', { refreshToken });

describe('POST /auth/login', () => {
  it('berhasil: token, perangkat terdaftar, refresh token tersimpan sebagai hash', async () => {
    const res = await env.login({ kind: 'desktop', name: 'PC kerja' });
    expect(res.statusCode).toBe(200);
    const body = LoginResponseSchema.parse(res.json());

    expect(body.expiresIn).toBe(900);
    expect(body.device).toMatchObject({ kind: 'desktop', name: 'PC kerja', scopes: ['app'] });

    const claims = decodeJwt(body.accessToken);
    expect(claims.sub).toBe(body.device.id);
    expect(claims.scope).toBe('app');
    expect((claims.exp ?? 0) - (claims.iat ?? 0)).toBe(900);

    expect(body.refreshToken.startsWith(`${body.device.id}.`)).toBe(true);
    const row = await deviceRow(body.device.id);
    expect(row?.tokenHash).toBe(sha256(body.refreshToken));
    expect(row?.tokenHash).not.toContain(body.refreshToken.split('.')[1] ?? 'x');
    expect(row?.refreshExpiresAt.getTime()).toBe(env.clock.now + 90 * DAY);

    const log = (await audits('auth.login')).find((a) => a.actorDeviceId === body.device.id);
    expect(log?.target).toContain(`device:${body.device.id}`);
  });

  it('scope mengikuti jenis perangkat: android app, worker mendapat worker dan llm', async () => {
    const phone = await env.loginOk({ kind: 'android', name: 'HP' });
    const worker = await env.loginOk({ kind: 'worker', name: 'Worker PC', pushToken: 'fcm-xyz' });
    expect(phone.device.scopes).toEqual(['app']);
    expect(worker.device.scopes).toEqual(['worker', 'llm']);
    expect(decodeJwt(worker.accessToken).scope).toBe('worker llm');
    expect((await deviceRow(worker.device.id))?.pushToken).toBe('fcm-xyz');
  });

  it('password salah: 401 invalid_credentials dan tidak ada perangkat baru', async () => {
    const before = (await env.database.handle.db.select().from(devices)).length;
    const res = await env.login({ password: `${OWNER_PASSWORD}x` });
    expect(res.statusCode).toBe(401);
    expect(problem(res)).toMatchObject({ code: 'invalid_credentials', status: 401 });
    expect((await env.database.handle.db.select().from(devices)).length).toBe(before);
    expect((await audits('auth.login_failed')).length).toBeGreaterThan(0);
  });

  it('TOTP salah: 401 dengan pesan yang sama seperti password salah', async () => {
    const wrongPassword = await env.login({ password: 'salah-salah-salah' });
    const wrongTotp = await env.login({ totp: '000000' });
    expect(wrongTotp.statusCode).toBe(401);
    expect(problem(wrongTotp)).toMatchObject({ code: 'invalid_credentials' });
    expect(problem(wrongTotp).detail).toBe(problem(wrongPassword).detail);
  });

  it('kode yang tertolak karena password salah tidak terbakar', async () => {
    env.clock.now += 30_000;
    const code = env.code();
    const bad = await env.post('/auth/login', {
      password: 'salah-salah-salah',
      totp: code,
      device: { name: 'x', kind: 'desktop' },
    });
    expect(bad.statusCode).toBe(401);
    const good = await env.post('/auth/login', {
      password: OWNER_PASSWORD,
      totp: code,
      device: { name: 'x', kind: 'desktop' },
    });
    expect(good.statusCode).toBe(200);
  });

  it('kode TOTP tidak bisa dipakai dua kali, termasuk kode langkah sebelumnya', async () => {
    env.clock.now += 30_000;
    const code = env.code();
    const body = (totp: string) => ({
      password: OWNER_PASSWORD,
      totp,
      device: { name: 'x', kind: 'desktop' as const },
    });
    expect((await env.post('/auth/login', body(code))).statusCode).toBe(200);
    const replay = await env.post('/auth/login', body(code));
    expect(replay.statusCode).toBe(401);
    expect(problem(replay).code).toBe('invalid_credentials');

    const { totpCode, timeStep } = await import('./totp.js');
    const previous = totpCode(env.totpSecret, timeStep(env.clock.now) - 1);
    expect((await env.post('/auth/login', body(previous))).statusCode).toBe(401);
  });

  it('isi tidak valid: 400 validation_failed', async () => {
    const res = await env.post('/auth/login', {
      password: 'x',
      totp: 'abc',
      device: { name: '', kind: 'tablet' },
    });
    expect(res.statusCode).toBe(400);
    expect(problem(res).code).toBe('validation_failed');
  });

  it('log dan audit tidak memuat password, kode TOTP, atau token', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _enc, done) {
        lines.push(chunk.toString());
        done();
      },
    });
    const logged = await createAuthEnv(inject('testDatabaseUrl'), { logStream: stream });
    try {
      const ok = await logged.loginOk();
      const text = lines.join('');
      expect(text).toContain('"requestId"');
      for (const secret of [
        OWNER_PASSWORD,
        ok.accessToken,
        ok.refreshToken,
        ok.refreshToken.split('.')[1] ?? 'x',
      ]) {
        expect(text).not.toContain(secret);
      }
      const audit = JSON.stringify(await logged.database.handle.db.select().from(auditLog));
      for (const secret of [OWNER_PASSWORD, ok.accessToken, ok.refreshToken]) {
        expect(audit).not.toContain(secret);
      }
    } finally {
      await logged.close();
    }
  });

  it('tanpa akun pemilik: 401 yang sama, bukan 500', async () => {
    const empty = await createAuthEnv(inject('testDatabaseUrl'), { owner: false });
    try {
      const res = await empty.login();
      expect(res.statusCode).toBe(401);
      expect(problem(res).code).toBe('invalid_credentials');
    } finally {
      await empty.close();
    }
  });
});

describe('POST /auth/refresh', () => {
  it('memutar token: pasangan baru bekerja, hash di database ikut berganti', async () => {
    const login = await env.loginOk();
    const res = await refresh(login.refreshToken);
    expect(res.statusCode).toBe(200);
    const pair = TokenPairSchema.parse(res.json());

    expect(pair.refreshToken).not.toBe(login.refreshToken);
    expect(pair.accessToken).not.toBe(login.accessToken);
    expect((await deviceRow(login.device.id))?.tokenHash).toBe(sha256(pair.refreshToken));
    expect((await env.get('/devices', pair.accessToken)).statusCode).toBe(200);

    const again = TokenPairSchema.parse((await refresh(pair.refreshToken)).json());
    expect(again.refreshToken).not.toBe(pair.refreshToken);
  });

  it('refresh token lama dipakai ulang: ditolak dan perangkat dicabut seluruhnya', async () => {
    const login = await env.loginOk({ name: 'Laptop bocor' });
    const rotated = TokenPairSchema.parse((await refresh(login.refreshToken)).json());

    const reuse = await refresh(login.refreshToken);
    expect(reuse.statusCode).toBe(401);
    expect(problem(reuse).code).toBe('refresh_token_reused');

    expect((await deviceRow(login.device.id))?.revokedAt).not.toBeNull();
    const log = (await audits('auth.refresh_reuse_detected')).find(
      (a) => a.actorDeviceId === login.device.id,
    );
    expect(log).toBeDefined();

    // Token baru milik perangkat yang sama (yang sah maupun yang dicuri) ikut mati.
    const afterRevoke = await refresh(rotated.refreshToken);
    expect(afterRevoke.statusCode).toBe(401);
    expect(problem(afterRevoke).code).toBe('invalid_refresh_token');
    const denied = await env.get('/devices', rotated.accessToken);
    expect(denied.statusCode).toBe(401);
    expect(problem(denied).code).toBe('invalid_token');
    expect((await env.get('/devices', login.accessToken)).statusCode).toBe(401);
  });

  it('dua refresh bersamaan dengan token yang sama: satu menang, perangkat dicabut', async () => {
    const login = await env.loginOk();
    const [a, b] = await Promise.all([refresh(login.refreshToken), refresh(login.refreshToken)]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 401]);
    expect((await deviceRow(login.device.id))?.revokedAt).not.toBeNull();
  });

  it('berlaku 90 hari sejak rotasi terakhir (sliding), lalu kedaluwarsa', async () => {
    const login = await env.loginOk();
    env.clock.now += 89 * DAY;
    const r1 = await refresh(login.refreshToken);
    expect(r1.statusCode).toBe(200);
    const t1 = TokenPairSchema.parse(r1.json());

    env.clock.now += 89 * DAY; // 178 hari sejak login, tetapi baru 89 hari sejak rotasi
    const r2 = await refresh(t1.refreshToken);
    expect(r2.statusCode).toBe(200);
    const t2 = TokenPairSchema.parse(r2.json());

    env.clock.now += 90 * DAY + 1000;
    const expired = await refresh(t2.refreshToken);
    expect(expired.statusCode).toBe(401);
    expect(problem(expired).code).toBe('refresh_token_expired');
  });

  it('token ngawur, perangkat tidak dikenal, atau tanpa isi: 401/400 tanpa membocorkan alasan', async () => {
    const login = await env.loginOk();
    const unknownDevice = `0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f.${'a'.repeat(43)}`;
    for (const token of ['ngawur', unknownDevice, `${login.device.id}.pendek`]) {
      const res = await refresh(token);
      expect(res.statusCode, token).toBe(401);
      expect(problem(res).code).toBe('invalid_refresh_token');
    }
    expect((await env.post('/auth/refresh', {})).statusCode).toBe(400);
  });
});

describe('POST /auth/logout', () => {
  it('mencabut perangkat: access dan refresh token berhenti bekerja, tercatat di audit', async () => {
    const login = await env.loginOk({ name: 'Keluar' });
    expect((await env.post('/auth/logout', undefined, login.accessToken)).statusCode).toBe(204);

    expect((await deviceRow(login.device.id))?.revokedAt).not.toBeNull();
    expect((await env.get('/devices', login.accessToken)).statusCode).toBe(401);
    const r = await refresh(login.refreshToken);
    expect(r.statusCode).toBe(401);
    expect(problem(r).code).toBe('invalid_refresh_token');
    expect((await audits('auth.logout')).some((a) => a.actorDeviceId === login.device.id)).toBe(
      true,
    );
  });

  it('tanpa token: 401', async () => {
    expect((await env.post('/auth/logout', undefined)).statusCode).toBe(401);
  });
});
