import { Writable } from 'node:stream';
import { PROBLEM_CONTENT_TYPE, ProblemSchema } from '@aios/contracts';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildApp } from './app.js';
import { AppError } from './errors.js';
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
  unusedStatus,
  unusedWorker,
  unusedSchedules,
  unusedRoles,
  unusedRouting,
  unusedRuns,
  unusedWs,
} from './testing/stubs.js';

const health = {
  readiness: () => Promise.reject(new Error('tidak dipakai di tes ini')),
};

function captureLogs() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, done) {
      for (const line of chunk.toString().split('\n').filter(Boolean)) {
        lines.push(JSON.parse(line) as Record<string, unknown>);
      }
      done();
    },
  });
  return { lines, stream };
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

function makeApp(logLevel: 'silent' | 'info' = 'silent', logStream?: NodeJS.WritableStream) {
  app = buildApp({
    config: { LOG_LEVEL: logLevel, NODE_ENV: 'test' },
    health,
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
    status: unusedStatus,
    worker: unusedWorker,
    routing: unusedRouting,
    ws: unusedWs,
    ...(logStream ? { logStream } : {}),
  });
  return app;
}

describe('error global RFC 9457', () => {
  it('route tak dikenal menjadi Problem 404', async () => {
    const res = await makeApp().inject({ method: 'GET', url: '/v1/tidak-ada' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
    const problem = ProblemSchema.parse(res.json());
    expect(problem).toMatchObject({
      status: 404,
      code: 'route_not_found',
      title: 'Tidak ditemukan',
    });
    expect(problem.instance).toBe(`urn:aios:request:${String(res.headers['x-request-id'])}`);
  });

  it('AppError dipetakan ke status dan kode domain', async () => {
    const a = makeApp();
    a.get('/boom', () => {
      throw new AppError(409, 'run_not_cancellable', 'Run sudah selesai.');
    });
    const res = await a.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(409);
    expect(ProblemSchema.parse(res.json())).toMatchObject({
      code: 'run_not_cancellable',
      detail: 'Run sudah selesai.',
      type: 'urn:aios:problem:run_not_cancellable',
    });
  });

  it('ZodError menjadi 400 validation_failed dengan daftar field', async () => {
    const a = makeApp();
    a.post('/v1/echo', (req) =>
      z.object({ name: z.string().min(1), age: z.number() }).parse(req.body),
    );
    const res = await a.inject({ method: 'POST', url: '/v1/echo', payload: { name: '' } });
    expect(res.statusCode).toBe(400);
    const problem = ProblemSchema.parse(res.json());
    expect(problem.code).toBe('validation_failed');
    expect(problem.errors?.map((e) => e.path).sort()).toEqual(['age', 'name']);
  });

  it('JSON rusak menjadi 400, bukan 500', async () => {
    const a = makeApp();
    a.post('/v1/echo', (req) => req.body);
    const res = await a.inject({
      method: 'POST',
      url: '/v1/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{"rusak":',
    });
    expect(res.statusCode).toBe(400);
    expect(ProblemSchema.parse(res.json()).status).toBe(400);
  });

  it('isi terlalu besar menjadi 413', async () => {
    const a = makeApp();
    a.post('/v1/echo', (req) => req.body);
    const res = await a.inject({
      method: 'POST',
      url: '/v1/echo',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ x: 'a'.repeat(1024 * 1024 + 10) }),
    });
    expect(res.statusCode).toBe(413);
    expect(ProblemSchema.parse(res.json()).status).toBe(413);
  });

  it('error tak terduga menjadi 500 generik tanpa membocorkan pesan asli', async () => {
    const a = makeApp();
    a.get('/boom', () => {
      throw new Error('password=hunter2 gagal konek ke 10.0.0.5');
    });
    const res = await a.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('hunter2');
    expect(res.body).not.toContain('10.0.0.5');
    expect(ProblemSchema.parse(res.json())).toMatchObject({ status: 500, code: 'internal_error' });
  });
});

describe('request ID dan log', () => {
  it('memakai X-Request-Id yang aman dan mengembalikannya', async () => {
    const res = await makeApp().inject({
      method: 'GET',
      url: '/v1/healthz',
      headers: { 'x-request-id': 'nginx-abc_123.4' },
    });
    expect(res.headers['x-request-id']).toBe('nginx-abc_123.4');
  });

  it('mengganti X-Request-Id yang tidak aman dengan UUID baru', async () => {
    const res = await makeApp().inject({
      method: 'GET',
      url: '/v1/healthz',
      headers: { 'x-request-id': 'a b"\\{injeksi}' },
    });
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('setiap baris log request memuat requestId yang sama dengan header respons', async () => {
    const { lines, stream } = captureLogs();
    const res = await makeApp('info', stream).inject({ method: 'GET', url: '/v1/healthz' });
    const id = res.headers['x-request-id'];
    const requestLines = lines.filter((l) => l.requestId !== undefined);
    expect(requestLines.length).toBeGreaterThanOrEqual(2); // incoming request + request completed
    expect(requestLines.every((l) => l.requestId === id)).toBe(true);
  });

  it('log menyensor header Authorization dan Cookie', async () => {
    const { lines, stream } = captureLogs();
    const a = makeApp('info', stream);
    a.get('/v1/log-header', (req) => {
      req.log.info(
        {
          headers: { authorization: 'Bearer RAHASIA' },
          upstream: { headers: { cookie: 'sid=RAHASIA' } },
        },
        'uji',
      );
      return {};
    });
    await a.inject({ method: 'GET', url: '/v1/log-header' });
    const raw = JSON.stringify(lines);
    expect(raw).not.toContain('RAHASIA');
    expect(raw).toContain('[redacted]');
  });
});
