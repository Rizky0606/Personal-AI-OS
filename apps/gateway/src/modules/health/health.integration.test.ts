import { ProblemSchema, ReadinessSchema } from '@aios/contracts';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import type { Config } from '../../config.js';
import { createTestDatabase, type TestDatabase } from '../../testing/db.js';
import { ok, startMockServer, type MockServer } from '../../testing/mock-server.js';
import {
  unusedAuth,
  unusedDevices,
  unusedChat,
  unusedFiles,
  unusedLlm,
  unusedResearch,
  unusedProjects,
  unusedTasks,
  unusedCompare,
  unusedMemory,
  unusedTemplates,
  unusedSpaces,
  unusedSearch,
  unusedStatus,
  unusedWorker,
  unusedSchedules,
  unusedRoles,
  unusedRouting,
  unusedRuns,
  unusedWs,
} from '../../testing/stubs.js';
import { createHealthService } from './service.js';

const HERMES_KEY = 'sk-hermes-rahasia-123';
const ROUTER_KEY = 'sk-router-rahasia-456';

let database: TestDatabase;
beforeAll(async () => {
  database = await createTestDatabase(inject('testDatabaseUrl'));
});
afterAll(async () => {
  await database.drop();
});

const servers: MockServer[] = [];
let app: FastifyInstance | undefined;
const extraPools: pg.Pool[] = [];

afterEach(async () => {
  await app?.close();
  app = undefined;
  await Promise.all(servers.splice(0).map((s) => s.close()));
  await Promise.all(extraPools.splice(0).map((p) => p.end()));
});

async function mock(handler = ok()) {
  const server = await startMockServer(handler);
  servers.push(server);
  return server;
}

/**
 * Layanan yang mati: port 2 praktis selalu tertutup (dan tidak diblokir fetch seperti port 1), jadi koneksi pasti
 * ditolak. Menutup server tiruan lalu memakai alamatnya tidak andal: di runner CI yang sibuk, port yang baru dilepas
 * bisa dipakai server lain.
 */
const closedService = (): MockServer => ({
  url: 'http://127.0.0.1:2',
  requests: [],
  close: () => Promise.resolve(),
});

interface Setup {
  hermes?: MockServer;
  router?: MockServer;
  searxng?: MockServer;
  pingDatabase?: () => Promise<unknown>;
  timeoutMs?: number;
}

async function makeApp(setup: Setup = {}) {
  const hermes = setup.hermes ?? (await mock());
  const router = setup.router ?? (await mock());
  const searxng = setup.searxng ?? (await mock());
  const config: Pick<
    Config,
    | 'HERMES_URL'
    | 'HERMES_API_KEY'
    | 'NINEROUTER_URL'
    | 'NINEROUTER_API_KEY'
    | 'SEARXNG_URL'
    | 'READY_TIMEOUT_MS'
  > = {
    HERMES_URL: hermes.url,
    HERMES_API_KEY: HERMES_KEY,
    NINEROUTER_URL: `${router.url}/v1`,
    NINEROUTER_API_KEY: ROUTER_KEY,
    SEARXNG_URL: searxng.url,
    READY_TIMEOUT_MS: setup.timeoutMs ?? 2000,
  };
  app = buildApp({
    config: { LOG_LEVEL: 'silent', NODE_ENV: 'test' },
    auth: unusedAuth,
    devices: unusedDevices,
    llm: unusedLlm,
    chat: unusedChat,
    files: unusedFiles,
    runs: unusedRuns,
    roles: unusedRoles,
    research: unusedResearch,
    schedules: unusedSchedules,
    projects: unusedProjects,
    tasks: unusedTasks,
    compare: unusedCompare,
    memory: unusedMemory,
    templates: unusedTemplates,
    spaces: unusedSpaces,
    search: unusedSearch,
    status: unusedStatus,
    worker: unusedWorker,
    routing: unusedRouting,
    ws: unusedWs,
    health: createHealthService({
      config,
      pingDatabase: setup.pingDatabase ?? (() => database.handle.pool.query('select 1')),
    }),
  });
  return { app, hermes, router, searxng };
}

async function readyz(a: FastifyInstance) {
  const res = await a.inject({ method: 'GET', url: '/v1/readyz' });
  return { res, body: ReadinessSchema.parse(res.json()) };
}

describe('GET /v1/healthz', () => {
  it('200 ok tanpa menyentuh dependensi', async () => {
    const { app: a } = await makeApp({
      pingDatabase: () => Promise.reject(new Error('tidak boleh dipanggil')),
    });
    const res = await a.inject({ method: 'GET', url: '/v1/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});

describe('GET /v1/readyz', () => {
  it('200 dan semua dependensi ok bila Postgres, Hermes, 9Router, dan SearXNG sehat', async () => {
    const { app: a, hermes, router, searxng } = await makeApp();
    const { res, body } = await readyz(a);

    expect(res.statusCode).toBe(200);
    expect(body.status).toBe('ok');
    for (const name of ['postgres', 'hermes', 'ninerouter', 'searxng'] as const) {
      expect(body.checks[name].ok, name).toBe(true);
      expect(body.checks[name].error, name).toBeUndefined();
      expect(body.checks[name].latencyMs, name).toBeGreaterThanOrEqual(0);
    }
    expect(hermes.requests.map((r) => r.url)).toEqual(['/health']);
    expect(router.requests.map((r) => r.url)).toEqual(['/v1/models']);
    expect(searxng.requests.map((r) => r.url)).toEqual(['/healthz']);
  });

  it('mengirim kunci API ke Hermes dan 9Router, tetapi tidak ke SearXNG', async () => {
    const { app: a, hermes, router, searxng } = await makeApp();
    await readyz(a);
    expect(hermes.requests[0]?.authorization).toBe(`Bearer ${HERMES_KEY}`);
    expect(router.requests[0]?.authorization).toBe(`Bearer ${ROUTER_KEY}`);
    expect(searxng.requests[0]?.authorization).toBeUndefined();
  });

  it('503 degraded dan menandai hanya Hermes bila Hermes mati', async () => {
    const hermes = closedService();
    const { app: a } = await makeApp({ hermes });
    const { res, body } = await readyz(a);

    expect(res.statusCode).toBe(503);
    expect(body.status).toBe('degraded');
    expect(body.checks.hermes).toMatchObject({ ok: false, error: 'ECONNREFUSED' });
    expect(body.checks.postgres.ok).toBe(true);
    expect(body.checks.ninerouter.ok).toBe(true);
    expect(body.checks.searxng.ok).toBe(true);
  });

  it('melaporkan status HTTP dependensi yang menjawab error atau mengalihkan', async () => {
    const router = await mock((_req, res) => {
      res.writeHead(500).end('rusak');
    });
    const searxng = await mock((_req, res) => {
      res.writeHead(302, { location: 'http://elsewhere.invalid/' }).end();
    });
    const { app: a } = await makeApp({ router, searxng });
    const { res, body } = await readyz(a);

    expect(res.statusCode).toBe(503);
    expect(body.checks.ninerouter).toMatchObject({ ok: false, error: 'HTTP 500' });
    expect(body.checks.searxng).toMatchObject({ ok: false, error: 'HTTP 302' });
  });

  it('dependensi yang lambat kena batas waktu pendek dan tidak menahan yang lain', async () => {
    const searxng = await mock(() => {
      /* tidak pernah menjawab */
    });
    const { app: a } = await makeApp({ searxng, timeoutMs: 300 });
    const started = performance.now();
    const { res, body } = await readyz(a);
    const elapsed = performance.now() - started;

    expect(res.statusCode).toBe(503);
    expect(body.checks.searxng).toMatchObject({ ok: false, error: 'timeout' });
    expect(body.checks.postgres.ok).toBe(true);
    expect(elapsed).toBeLessThan(1500);
  });

  it('503 bila Postgres menolak koneksi', async () => {
    const pool = new pg.Pool({
      connectionString: 'postgres://aios:x@127.0.0.1:1/postgres',
      connectionTimeoutMillis: 1000,
    });
    pool.on('error', () => undefined);
    extraPools.push(pool);
    const { app: a } = await makeApp({ pingDatabase: () => pool.query('select 1') });
    const { res, body } = await readyz(a);

    expect(res.statusCode).toBe(503);
    expect(body.checks.postgres).toMatchObject({ ok: false, error: 'ECONNREFUSED' });
    expect(body.checks.hermes.ok).toBe(true);
  });

  it('503 bila kredensial Postgres salah, tanpa membocorkan pesan driver', async () => {
    const url = new URL(database.url);
    url.password = 'password-salah';
    const pool = new pg.Pool({ connectionString: url.toString(), connectionTimeoutMillis: 2000 });
    pool.on('error', () => undefined);
    extraPools.push(pool);
    const { app: a } = await makeApp({ pingDatabase: () => pool.query('select 1') });
    const { body } = await readyz(a);

    expect(body.checks.postgres).toMatchObject({ ok: false, error: 'autentikasi ditolak' });
    expect(JSON.stringify(body)).not.toContain('password-salah');
  });

  it('respons tidak memuat kunci API, URL, atau pesan mentah', async () => {
    const hermes = closedService();
    const { app: a } = await makeApp({ hermes });
    const { res } = await readyz(a);

    expect(res.body).not.toContain(HERMES_KEY);
    expect(res.body).not.toContain(ROUTER_KEY);
    expect(res.body).not.toContain('127.0.0.1');
    expect(res.body).not.toContain('http');
  });

  it('endpoint tidak butuh auth dan menolak method selain GET dengan Problem', async () => {
    const { app: a } = await makeApp();
    const res = await a.inject({ method: 'POST', url: '/v1/readyz' });
    expect(res.statusCode).toBe(404);
    expect(ProblemSchema.safeParse(res.json()).success).toBe(true);
  });
});
