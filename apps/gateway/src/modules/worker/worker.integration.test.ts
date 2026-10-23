import {
  GatewayToWorkerFrameSchema,
  LoginResponseSchema,
  RunEventsResponseSchema,
  type AgentEvent,
  type GatewayToWorkerFrame,
} from '@aios/contracts';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { conversations, runs } from '../../db/schema/index.js';
import { createAuthEnv, type AuthEnv } from '../../testing/auth-env.js';
import { TestWs } from '../../testing/ws-client.js';
import { WORKER_CLOSE_REPLACED } from './routes.js';

let env: AuthEnv;
let desktop: string;
let url: string;

beforeAll(async () => {
  env = await createAuthEnv(inject('testDatabaseUrl'), { heartbeatMs: 200 });
  desktop = (await env.loginOk({ kind: 'desktop' })).accessToken;
  await env.app.listen({ port: 0, host: '127.0.0.1' });
  const port = (env.app.server.address() as AddressInfo).port;
  url = `ws://127.0.0.1:${port}/v1/worker/ws`;
});
afterAll(async () => {
  await env.close();
});

const stack = { languages: ['typescript'], frameworks: [] };

/** Klien worker tiruan: mengumpulkan frame gateway yang sudah divalidasi kontrak. */
class FakeWorker {
  readonly frames: GatewayToWorkerFrame[] = [];
  closeCode: number | undefined;
  private constructor(private readonly socket: WebSocket) {
    socket.on('message', (data: Buffer) => {
      this.frames.push(GatewayToWorkerFrameSchema.parse(JSON.parse(data.toString('utf8'))));
    });
    socket.on('close', (code: number) => {
      this.closeCode = code;
    });
  }
  static async connect(token: string): Promise<FakeWorker> {
    const socket = new WebSocket(url, { headers: { authorization: `Bearer ${token}` } });
    const worker = new FakeWorker(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
      socket.once('unexpected-response', (_req, res) =>
        reject(new Error(`HTTP ${res.statusCode}`)),
      );
    });
    return worker;
  }
  send(frame: object) {
    this.socket.send(JSON.stringify(frame));
  }
  close() {
    this.socket.close();
  }
  async until(check: () => boolean, label: string, timeoutMs = 3000) {
    const start = Date.now();
    while (!check()) {
      if (Date.now() - start > timeoutMs) throw new Error(`timeout menunggu ${label}`);
      await new Promise((r) => setTimeout(r, 10));
    }
  }
}

async function setup(name: string) {
  const worker = LoginResponseSchema.parse(
    (await env.post('/devices/worker', { name }, desktop)).json(),
  );
  const projectRes = await env.post(
    '/projects',
    { name: `Project ${name}`, workerDeviceId: worker.device.id, stack },
    desktop,
  );
  const project = projectRes.json<{ id: string }>();
  const { db } = env.database.handle;
  const [conversation] = await db
    .insert(conversations)
    .values({ title: 'Coding', surface: 'windows', projectId: project.id })
    .returning();
  const [run] = await db
    .insert(runs)
    .values({
      kind: 'coding',
      engine: 'omp',
      status: 'running',
      conversationId: conversation?.id ?? null,
    })
    .returning();
  return { worker, project, runId: run?.id ?? '' };
}

const delta = (text: string): AgentEvent => ({
  type: 'message.delta',
  messageId: '0192f0c4-7a1b-7c2d-9e3f-4a5b6c7d8e90',
  text,
});

describe('handshake', () => {
  it('tanpa token 401, token app 403, token worker tersambung dan menerima ready', async () => {
    expect(await TestWs.rejected(url, undefined)).toBe(401);
    expect(await TestWs.rejected(url, desktop)).toBe(403);

    const { worker } = await setup('Worker H');
    const conn = await FakeWorker.connect(worker.accessToken);
    await conn.until(() => conn.frames.length > 0, 'ready');

    expect(conn.frames[0]).toEqual({ type: 'ready', deviceId: worker.device.id });
    conn.send({ type: 'ping' });
    await conn.until(() => conn.frames.some((f) => f.type === 'pong'), 'pong');
    conn.close();
  });
});

describe('run.event', () => {
  it('event run milik project worker disimpan berurutan dan disiarkan ke pelanggan run:<id>', async () => {
    const { worker, runId } = await setup('Worker E');
    const app = await TestWs.connect(url.replace('/worker/ws', '/ws'), desktop);
    app.send({ type: 'subscribe', channel: `run:${runId}` });
    await app.until(
      () => app.messages.some((m) => 'type' in m && m.type === 'subscribed'),
      2000,
      'subscribed',
    );
    const conn = await FakeWorker.connect(worker.accessToken);

    conn.send({ type: 'run.event', runId, event: delta('Halo ') });
    conn.send({ type: 'run.event', runId, event: delta('dunia') });

    await app.until(() => app.envelopes(`run:${runId}`).length === 2, 2000, 'dua event');
    expect(app.envelopes().map((e) => e.seq)).toEqual([1, 2]);
    const stored = RunEventsResponseSchema.parse(
      (await env.get(`/runs/${runId}/events`, desktop)).json(),
    );
    expect(stored.items.map((i) => i.event)).toEqual([delta('Halo '), delta('dunia')]);
    app.close();
    conn.close();
  });

  it('run milik worker lain ditolak run_not_owned dan tidak disimpan', async () => {
    const mine = await setup('Worker M');
    const other = await setup('Worker O');
    const conn = await FakeWorker.connect(mine.worker.accessToken);

    conn.send({ type: 'run.event', runId: other.runId, event: delta('curang') });
    await conn.until(
      () => conn.frames.some((f) => f.type === 'error' && f.code === 'run_not_owned'),
      'run_not_owned',
    );

    const stored = RunEventsResponseSchema.parse(
      (await env.get(`/runs/${other.runId}/events`, desktop)).json(),
    );
    expect(stored.items).toEqual([]);
    conn.close();
  });

  it('frame tidak valid dijawab error invalid_message; koneksi tetap hidup', async () => {
    const { worker } = await setup('Worker I');
    const conn = await FakeWorker.connect(worker.accessToken);

    conn.send({ type: 'run.event', runId: 'bukan-uuid', event: {} });
    conn.send({ type: 'tidak-dikenal' });
    await conn.until(
      () =>
        conn.frames.filter((f) => f.type === 'error' && f.code === 'invalid_message').length === 2,
      'dua error',
    );

    conn.send({ type: 'ping' });
    await conn.until(() => conn.frames.some((f) => f.type === 'pong'), 'pong');
    conn.close();
  });
});

describe('satu koneksi per perangkat', () => {
  it('koneksi baru menggantikan yang lama: lama menerima error replaced dan ditutup 4409', async () => {
    const { worker } = await setup('Worker R');
    const first = await FakeWorker.connect(worker.accessToken);
    await first.until(() => first.frames.length > 0, 'ready pertama');

    const second = await FakeWorker.connect(worker.accessToken);
    await first.until(() => first.closeCode !== undefined, 'penutupan');

    expect(first.closeCode).toBe(WORKER_CLOSE_REPLACED);
    expect(first.frames.some((f) => f.type === 'error' && f.code === 'replaced')).toBe(true);
    second.send({ type: 'ping' });
    await second.until(() => second.frames.some((f) => f.type === 'pong'), 'pong kedua');
    second.close();
  });
});

describe('masa berlaku', () => {
  it('perangkat dicabut: koneksi ditutup 4401 pada heartbeat berikutnya', async () => {
    const { worker } = await setup('Worker X');
    const conn = await FakeWorker.connect(worker.accessToken);
    await conn.until(() => conn.frames.length > 0, 'ready');

    await env.del(`/devices/${worker.device.id}`, desktop);

    await conn.until(() => conn.closeCode !== undefined, 'penutupan');
    expect(conn.closeCode).toBe(4401);
  });
});
