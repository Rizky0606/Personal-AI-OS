import { endpoints } from '@aios/contracts';
import type { RouteOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createAuthEnv, type AuthEnv } from './testing/auth-env.js';

/**
 * Audit keamanan otomatis (Fase 23): setiap route yang benar-benar terdaftar di aplikasi diperiksa
 * terhadap matriks auth dan scope. Route baru tanpa penjagaan membuat tes ini gagal.
 */

/** Ada di kontrak tetapi sengaja belum dibuat (lampiran berkas ditunda; lihat docs/BACKLOG.md). */
const DEFERRED: string[] = [];

type Expected = 'public' | 'any' | 'app' | 'worker' | 'llm';

/** Route tanpa token (login dan pemantauan). Selain ini semuanya wajib login. */
const PUBLIC = new Set([
  'GET /v1/healthz',
  'GET /v1/readyz',
  'POST /v1/auth/login',
  'POST /v1/auth/refresh',
]);
/** Route yang cukup login (scope apa pun): hanya mengakhiri sesi perangkat sendiri. */
const ANY_SCOPE = new Set(['POST /v1/auth/logout']);

function expectedScope(method: string, url: string): Expected {
  const key = `${method} ${url}`;
  if (PUBLIC.has(key)) return 'public';
  if (ANY_SCOPE.has(key)) return 'any';
  if (url.startsWith('/llm/v1')) return 'llm';
  if (url === '/v1/worker/ws' || url === '/v1/worker/artifacts/screenshot') return 'worker';
  return 'app';
}

let env: AuthEnv;
const routes: { method: string; url: string }[] = [];
let app: string;
let worker: string;

beforeAll(async () => {
  env = await createAuthEnv(inject('testDatabaseUrl'));
  // Route dipasang saat aplikasi siap, jadi hook ini menangkap semuanya.
  env.app.addHook('onRoute', (route: RouteOptions) => {
    for (const method of [route.method].flat()) {
      if (method !== 'HEAD' && method !== 'OPTIONS') routes.push({ method, url: route.url });
    }
  });
  app = (await env.loginOk({ kind: 'desktop' })).accessToken;
  worker = (await env.loginOk({ kind: 'worker' })).accessToken;
  await env.app.ready();
});
afterAll(() => env.close());

const concrete = (url: string) =>
  url.replace(/:[A-Za-z]+/g, '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f').replace(/\/\*$/, '/models');

const call = (method: string, url: string, token?: string) =>
  env.app.inject({
    method: method as 'GET',
    url: concrete(url),
    headers: token ? { authorization: `Bearer ${token}` } : {},
    // Isi sengaja kosong: penjagaan harus menolak sebelum isi diperiksa.
    ...(method === 'GET' ? {} : { payload: {} }),
  });

describe('audit auth dan scope', () => {
  it('menemukan route aplikasi (bukan daftar kosong)', () => {
    expect(routes.length).toBeGreaterThan(45);
    const keys = routes.map((r) => `${r.method} ${r.url}`);
    for (const must of [
      'POST /v1/tasks',
      'POST /v1/compare',
      'GET /v1/quota',
      'POST /v1/runs/:id/review',
    ]) {
      expect(keys).toContain(must);
    }
  });

  it('semua route selain yang publik menolak permintaan tanpa token (401) dan token palsu (401)', async () => {
    const open: string[] = [];
    for (const { method, url } of routes) {
      const key = `${method} ${url}`;
      if (PUBLIC.has(key)) continue;
      for (const token of [undefined, 'bukan-token']) {
        const res = await call(method, url, token);
        if (res.statusCode !== 401)
          open.push(`${key} -> ${res.statusCode} (${token ? 'token palsu' : 'tanpa token'})`);
      }
    }
    expect(open).toEqual([]);
  });

  it('token worker ditolak (403) di semua route aplikasi; token aplikasi ditolak di route worker dan llm', async () => {
    const wrong: string[] = [];
    for (const { method, url } of routes) {
      const key = `${method} ${url}`;
      const expected = expectedScope(method, url);
      if (expected === 'public' || expected === 'any') continue;
      const forbidden = expected === 'app' ? worker : app;
      const res = await call(method, url, forbidden);
      if (res.statusCode !== 403)
        wrong.push(
          `${key} -> ${res.statusCode} dengan token ${expected === 'app' ? 'worker' : 'app'}`,
        );
    }
    expect(wrong).toEqual([]);
  });

  it('route REST persis sama dengan kontrak: tidak ada route tanpa kontrak dan tidak ada kontrak tanpa route', () => {
    const registered = routes
      .filter((r) => r.url.startsWith('/v1/') && !['/v1/ws', '/v1/worker/ws'].includes(r.url))
      .map((r) => `${r.method} ${r.url}`)
      .sort();
    const contracted = endpoints
      .filter((e) => !DEFERRED.includes(`${e.method.toUpperCase()} /v1${e.path}`))
      .map((e) => `${e.method.toUpperCase()} /v1${e.path.replaceAll(/\{(\w+)\}/g, ':$1')}`)
      .sort();
    expect(registered).toEqual(contracted);
  });

  it('route publik hanya empat; logout butuh login', async () => {
    const publicOnes = routes.map((r) => `${r.method} ${r.url}`).filter((k) => PUBLIC.has(k));
    expect(publicOnes.sort()).toEqual([...PUBLIC].sort());
    expect((await call('POST', '/v1/auth/logout')).statusCode).toBe(401);
  });
});

describe('audit lain', () => {
  it('galat 500 tidak membocorkan stack atau pesan internal', async () => {
    const res = await env.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: '{rusak',
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toMatch(/at .*\.(ts|js):\d+/);
    expect(res.headers['content-type']).toContain('application/problem+json');
  });

  it('CORS ditutup: preflight dari origin lain tidak mendapat izin', async () => {
    const res = await env.app.inject({
      method: 'OPTIONS',
      url: '/v1/models',
      headers: { origin: 'https://situs-lain.example', 'access-control-request-method': 'GET' },
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('isi permintaan di atas batas ditolak (413)', async () => {
    const res = await env.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ password: 'x'.repeat(2 * 1024 * 1024) }),
    });
    expect(res.statusCode).toBe(413);
  });

  it('token kedaluwarsa atau dicabut ditolak', async () => {
    const dead = await env.loginOk({ kind: 'desktop', name: 'dicabut' });
    expect((await env.post('/auth/logout', {}, dead.accessToken)).statusCode).toBe(204);
    expect((await env.get('/models', dead.accessToken)).statusCode).toBe(401);
  });
});

describe('audit log bebas rahasia', () => {
  it('login, token, dan panggilan proxy model tidak meninggalkan password, kode TOTP, token, atau API key di log', async () => {
    const lines: string[] = [];
    const { Writable } = await import('node:stream');
    const sink = new Writable({
      write(chunk: Buffer, _enc, done) {
        lines.push(chunk.toString('utf8'));
        done();
      },
    });
    const { OWNER_PASSWORD } = await import('./testing/auth-env.js');
    const logged = await createAuthEnv(inject('testDatabaseUrl'), {
      logStream: sink,
      ninerouterKey: 'sk-kunci-9router-rahasia',
    });
    try {
      const code = logged.code();
      await logged.app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: {
          password: 'password-salah-xyz',
          totp: '000000',
          device: { name: 'x', kind: 'desktop' },
        },
      });
      const session = await logged.loginOk({ kind: 'desktop' });
      await logged.get('/models', session.accessToken);
      await logged.app.inject({
        method: 'POST',
        url: '/llm/v1/chat/completions',
        headers: {
          authorization: `Bearer ${session.accessToken}`,
          'content-type': 'application/json',
        },
        payload: { model: 'm', messages: [{ role: 'user', content: 'isi-pesan-rahasia' }] },
      });
      await logged.post('/auth/logout', {}, session.accessToken);

      const output = lines.join('');
      expect(output.length).toBeGreaterThan(0);
      for (const secret of [
        OWNER_PASSWORD,
        'password-salah-xyz',
        code,
        session.accessToken,
        session.refreshToken,
        'sk-kunci-9router-rahasia',
        'isi-pesan-rahasia',
      ]) {
        expect(output, `log memuat "${secret.slice(0, 8)}…"`).not.toContain(secret);
      }
    } finally {
      await logged.close();
    }
  });
});
