import { DeviceListSchema, ProblemSchema, TokenPairSchema } from '@aios/contracts';
import { SignJWT } from 'jose';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { auditLog, devices } from '../../db/schema/index.js';
import {
  AUTH_SECRET,
  OWNER_PASSWORD,
  createAuthEnv,
  type AuthEnv,
} from '../../testing/auth-env.js';
import { saveOwner } from '../auth/owner.js';
import { deriveAuthKeys } from '../auth/secrets.js';
import { generateTotpSecret } from '../auth/totp.js';

let env: AuthEnv;
beforeAll(async () => {
  env = await createAuthEnv(inject('testDatabaseUrl'));
});
afterAll(async () => {
  await env.close();
});

const problem = (res: { json(): unknown }) => ProblemSchema.parse(res.json());
const MISSING = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';
const allAudit = () => env.database.handle.db.select().from(auditLog);

describe('middleware autentikasi', () => {
  it('route terproteksi tanpa token atau dengan skema salah: 401 + WWW-Authenticate', async () => {
    const none = await env.get('/devices');
    expect(none.statusCode).toBe(401);
    expect(problem(none).code).toBe('missing_token');
    expect(none.headers['www-authenticate']).toBe('Bearer');

    const basic = await env.app.inject({
      method: 'GET',
      url: '/v1/devices',
      headers: { authorization: 'Basic dXNlcjpwYXNz' },
    });
    expect(problem(basic).code).toBe('missing_token');
  });

  it('token acak, token dari kunci lain, dan token tanpa tanda tangan: 401 invalid_token', async () => {
    const forged = await new SignJWT({ scope: 'app' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(MISSING)
      .setIssuer('aios-gateway')
      .setAudience('aios')
      .setJti('j')
      .setIssuedAt(Math.floor(env.clock.now / 1000))
      .setExpirationTime(Math.floor(env.clock.now / 1000) + 900)
      .sign(deriveAuthKeys('kunci-penyerang-'.padEnd(48, 'z')).jwt);
    for (const token of ['bukan.jwt.sama-sekali', forged]) {
      const res = await env.get('/devices', token);
      expect(res.statusCode).toBe(401);
      expect(problem(res).code).toBe('invalid_token');
    }
  });

  it('token bertanda tangan benar untuk perangkat yang tidak ada: 401', async () => {
    const orphan = await new SignJWT({ scope: 'app' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(MISSING)
      .setIssuer('aios-gateway')
      .setAudience('aios')
      .setJti('j')
      .setIssuedAt(Math.floor(env.clock.now / 1000))
      .setExpirationTime(Math.floor(env.clock.now / 1000) + 900)
      .sign(deriveAuthKeys(AUTH_SECRET).jwt);
    expect((await env.get('/devices', orphan)).statusCode).toBe(401);
  });

  it('access token berlaku 15 menit: 14:59 ok, 15:01 token_expired, lalu refresh memulihkan', async () => {
    const login = await env.loginOk();
    const issued = env.clock.now;

    env.clock.now = issued + 899_000;
    expect((await env.get('/devices', login.accessToken)).statusCode).toBe(200);

    env.clock.now = issued + 901_000;
    const expired = await env.get('/devices', login.accessToken);
    expect(expired.statusCode).toBe(401);
    expect(problem(expired).code).toBe('token_expired');
    expect(expired.headers['www-authenticate']).toBe('Bearer');

    const refreshed = await env.post('/auth/refresh', { refreshToken: login.refreshToken });
    const pair = TokenPairSchema.parse(refreshed.json());
    expect((await env.get('/devices', pair.accessToken)).statusCode).toBe(200);
  });

  it('scope dicek: token worker (worker, llm) ditolak 403 di endpoint scope app', async () => {
    const worker = await env.loginOk({ kind: 'worker', name: 'Worker' });
    const res = await env.get('/devices', worker.accessToken);
    expect(res.statusCode).toBe(403);
    expect(problem(res)).toMatchObject({ code: 'insufficient_scope', status: 403 });
    expect((await env.del(`/devices/${worker.device.id}`, worker.accessToken)).statusCode).toBe(
      403,
    );
  });

  it('endpoint publik tetap terbuka tanpa token', async () => {
    expect((await env.get('/healthz')).statusCode).toBe(200);
  });

  it('last_seen_at diperbarui saat dipakai', async () => {
    const login = await env.loginOk();
    env.clock.now += 5 * 60_000;
    await env.get('/devices', login.accessToken);
    const [row] = await env.database.handle.db
      .select()
      .from(devices)
      .where(eq(devices.id, login.device.id));
    expect(row?.lastSeenAt?.getTime()).toBe(env.clock.now);
  });
});

describe('endpoint perangkat', () => {
  it('GET /devices hanya menampilkan perangkat aktif dan tanpa kolom rahasia', async () => {
    const a = await env.loginOk({ kind: 'desktop', name: 'Desktop A' });
    const b = await env.loginOk({ kind: 'android', name: 'HP B', pushToken: 'fcm-rahasia-b' });
    const res = await env.get('/devices', a.accessToken);
    expect(res.statusCode).toBe(200);
    const list = DeviceListSchema.parse(res.json());
    const ids = list.items.map((d) => d.id);
    expect(ids).toContain(a.device.id);
    expect(ids).toContain(b.device.id);
    expect(res.body).not.toMatch(
      /tokenHash|token_hash|pushToken|push_token|fcm-rahasia-b|revoked/i,
    );
  });

  it('POST /devices/:id/push-token menyimpan token tanpa menampilkannya, tercatat di audit tanpa nilainya', async () => {
    const a = await env.loginOk({ name: 'Desktop' });
    const b = await env.loginOk({ kind: 'android', name: 'HP' });
    const res = await env.post(
      `/devices/${b.device.id}/push-token`,
      { pushToken: 'fcm-token-sangat-rahasia' },
      a.accessToken,
    );
    expect(res.statusCode).toBe(204);

    const [row] = await env.database.handle.db
      .select()
      .from(devices)
      .where(eq(devices.id, b.device.id));
    expect(row?.pushToken).toBe('fcm-token-sangat-rahasia');
    expect((await env.get('/devices', a.accessToken)).body).not.toContain(
      'fcm-token-sangat-rahasia',
    );

    const audit = await allAudit();
    const entry = audit.find(
      (e) => e.action === 'device.push_token_set' && e.target === `device:${b.device.id}`,
    );
    expect(entry?.actorDeviceId).toBe(a.device.id);
    expect(JSON.stringify(audit)).not.toContain('fcm-token-sangat-rahasia');
  });

  it('push-token: isi kosong 400, perangkat tidak ada 404, ID bukan UUID 400', async () => {
    const a = await env.loginOk();
    expect(
      (await env.post(`/devices/${a.device.id}/push-token`, { pushToken: '' }, a.accessToken))
        .statusCode,
    ).toBe(400);
    const missing = await env.post(
      `/devices/${MISSING}/push-token`,
      { pushToken: 'x' },
      a.accessToken,
    );
    expect(missing.statusCode).toBe(404);
    expect(problem(missing).code).toBe('device_not_found');
    expect(
      (await env.post('/devices/abc/push-token', { pushToken: 'x' }, a.accessToken)).statusCode,
    ).toBe(400);
  });

  it('DELETE /devices/:id mencabut perangkat lain: token mati, hilang dari daftar, tercatat', async () => {
    const a = await env.loginOk({ name: 'Admin' });
    const b = await env.loginOk({ kind: 'android', name: 'HP hilang' });

    expect((await env.del(`/devices/${b.device.id}`, a.accessToken)).statusCode).toBe(204);

    const list = DeviceListSchema.parse((await env.get('/devices', a.accessToken)).json());
    expect(list.items.map((d) => d.id)).not.toContain(b.device.id);
    expect((await env.get('/devices', b.accessToken)).statusCode).toBe(401);
    const r = await env.post('/auth/refresh', { refreshToken: b.refreshToken });
    expect(r.statusCode).toBe(401);
    expect(problem(r).code).toBe('invalid_refresh_token');

    const entry = (await allAudit()).find(
      (e) => e.action === 'device.revoked' && e.target === `device:${b.device.id}`,
    );
    expect(entry?.actorDeviceId).toBe(a.device.id);
  });

  it('DELETE dua kali atau ID tak dikenal: 404; perangkat sendiri bisa dicabut', async () => {
    const a = await env.loginOk();
    const b = await env.loginOk();
    await env.del(`/devices/${b.device.id}`, a.accessToken);
    const again = await env.del(`/devices/${b.device.id}`, a.accessToken);
    expect(again.statusCode).toBe(404);
    expect((await env.del(`/devices/${MISSING}`, a.accessToken)).statusCode).toBe(404);

    expect((await env.del(`/devices/${a.device.id}`, a.accessToken)).statusCode).toBe(204);
    expect((await env.get('/devices', a.accessToken)).statusCode).toBe(401);
  });
});

describe('rate limit', () => {
  it('login dibatasi 5 per menit per IP; IP lain tidak ikut terkena', async () => {
    const limited = await createAuthEnv(inject('testDatabaseUrl'), {
      rateLimits: { login: 5 },
    });
    try {
      const attempt = (ip: string) => limited.login({ password: 'salah-salah-salah', ip });
      for (let i = 0; i < 5; i++) expect((await attempt('203.0.113.7')).statusCode).toBe(401);

      const blocked = await attempt('203.0.113.7');
      expect(blocked.statusCode).toBe(429);
      expect(problem(blocked)).toMatchObject({ code: 'rate_limited', status: 429 });
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);

      // Pemilik yang sah dari IP yang sama pun tertahan sampai jendela habis.
      expect((await limited.login({ ip: '203.0.113.7' })).statusCode).toBe(429);
      expect((await attempt('198.51.100.9')).statusCode).toBe(401);
    } finally {
      await limited.close();
    }
  });

  it('API umum dibatasi per perangkat; health tidak dibatasi', async () => {
    const limited = await createAuthEnv(inject('testDatabaseUrl'), {
      rateLimits: { general: 3 },
    });
    try {
      const a = await limited.loginOk({ name: 'A' });
      const b = await limited.loginOk({ name: 'B' });
      for (let i = 0; i < 3; i++)
        expect((await limited.get('/devices', a.accessToken)).statusCode).toBe(200);
      const blocked = await limited.get('/devices', a.accessToken);
      expect(blocked.statusCode).toBe(429);
      expect(problem(blocked).code).toBe('rate_limited');

      expect((await limited.get('/devices', b.accessToken)).statusCode).toBe(200);
      for (let i = 0; i < 10; i++) expect((await limited.get('/healthz')).statusCode).toBe(200);
    } finally {
      await limited.close();
    }
  });
});

describe('akun pemilik (saveOwner)', () => {
  it('menolak password pendek dan akun kedua tanpa reset', async () => {
    const e = await createAuthEnv(inject('testDatabaseUrl'), { owner: false });
    try {
      const { db } = e.database.handle;
      const keys = deriveAuthKeys(AUTH_SECRET);
      await expect(
        saveOwner(db, keys, { password: 'pendek', totpSecret: generateTotpSecret() }),
      ).rejects.toMatchObject({ code: 'weak_password', status: 400 });

      await saveOwner(db, keys, { password: OWNER_PASSWORD, totpSecret: generateTotpSecret() });
      await expect(
        saveOwner(db, keys, { password: OWNER_PASSWORD, totpSecret: generateTotpSecret() }),
      ).rejects.toMatchObject({ code: 'owner_exists', status: 409 });
    } finally {
      await e.close();
    }
  });

  it('reset mengganti password dan TOTP, mencabut semua perangkat, dan password lama tak berlaku', async () => {
    const e = await createAuthEnv(inject('testDatabaseUrl'));
    try {
      const old = await e.loginOk();
      const newSecret = generateTotpSecret();
      const result = await saveOwner(
        e.database.handle.db,
        deriveAuthKeys(AUTH_SECRET),
        { password: 'password-baru-yang-panjang', totpSecret: newSecret, reset: true },
        () => e.clock.now,
      );
      expect(result.revokedDevices).toBe(1);
      expect((await e.get('/devices', old.accessToken)).statusCode).toBe(401);

      expect((await e.login()).statusCode).toBe(401); // password lama + TOTP lama
      const { totpCode, timeStep } = await import('../auth/totp.js');
      e.clock.now += 30_000;
      const res = await e.post('/auth/login', {
        password: 'password-baru-yang-panjang',
        totp: totpCode(newSecret, timeStep(e.clock.now)),
        device: { name: 'baru', kind: 'desktop' },
      });
      expect(res.statusCode).toBe(200);

      const actions = (await e.database.handle.db.select().from(auditLog)).map((a) => a.action);
      expect(actions).toEqual(expect.arrayContaining(['owner.created', 'owner.reset']));
    } finally {
      await e.close();
    }
  });
});
