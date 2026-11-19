import {
  GatewayToWorkerFrameSchema,
  LoginResponseSchema,
  ProblemSchema,
  ProjectSchema,
  ProjectWorkerStatusSchema,
  RunSchema,
  SendMessageResponseSchema,
  workerBranchFor,
  type AgentEvent,
  type GatewayToWorkerFrame,
  type WorkerReviewResultFrame,
} from '@aios/contracts';
import { eq } from 'drizzle-orm';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { auditLog, projects } from '../../db/schema/index.js';
import { createAuthEnv, type AuthEnv } from '../../testing/auth-env.js';

let env: AuthEnv;
let desktop: string;
let url: string;

beforeAll(async () => {
  env = await createAuthEnv(inject('testDatabaseUrl'), {
    workerRelay: { disconnectGraceMs: 400, cancelGraceMs: 300 },
  });
  desktop = (await env.loginOk({ kind: 'desktop' })).accessToken;
  await env.app.listen({ port: 0, host: '127.0.0.1' });
  url = `ws://127.0.0.1:${(env.app.server.address() as AddressInfo).port}/v1/worker/ws`;
});
afterAll(async () => {
  for (const worker of allWorkers) worker.close();
  await env.close();
});

const allWorkers: FakeWorker[] = [];
const stack = { languages: ['typescript'], frameworks: [] };
const file = { path: 'a.ts', additions: 1, deletions: 0 };
const MISSING = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => boolean | Promise<boolean>, label: string, ms = 5000) {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > ms) throw new Error(`timeout menunggu ${label}`);
    await sleep(15);
  }
}

type Command = Extract<GatewayToWorkerFrame, { type: string }>;

/** Worker tiruan: mencatat perintah gateway, menjawab `review.apply` bila `reply` diisi. */
class FakeWorker {
  readonly commands: Command[] = [];
  reply: ((cmd: Extract<Command, { type: 'review.apply' }>) => WorkerReviewResultFrame) | undefined;
  private socket: WebSocket | undefined;
  constructor(
    readonly token: string,
    readonly deviceId: string,
  ) {
    allWorkers.push(this);
  }

  async connect(): Promise<void> {
    const socket = new WebSocket(url, { headers: { authorization: `Bearer ${this.token}` } });
    this.socket = socket;
    socket.on('message', (data: Buffer) => {
      const frame = GatewayToWorkerFrameSchema.parse(JSON.parse(data.toString('utf8')));
      this.commands.push(frame);
      if (frame.type === 'review.apply' && this.reply)
        socket.send(JSON.stringify(this.reply(frame)));
    });
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
  }

  emit(runId: string, event: AgentEvent) {
    this.socket?.send(JSON.stringify({ type: 'run.event', runId, event }));
  }

  pending(runs: { runId: string; files: (typeof file)[] }[]) {
    this.socket?.send(JSON.stringify({ type: 'workspace.pending', runs }));
  }

  close() {
    this.socket?.terminate();
  }

  all<T extends Command['type']>(type: T) {
    return this.commands.filter((c) => c.type === type) as Extract<Command, { type: T }>[];
  }
}

async function registerWorker(name: string) {
  const res = await env.post('/devices/worker', { name }, desktop);
  expect(res.statusCode, res.body).toBe(201);
  const worker = LoginResponseSchema.parse(res.json());
  return new FakeWorker(worker.accessToken, worker.device.id);
}

async function createProject(workerDeviceId: string, name: string) {
  const res = await env.post('/projects', { name, workerDeviceId, stack }, desktop);
  expect(res.statusCode, res.body).toBe(201);
  return ProjectSchema.parse(res.json());
}

async function conversationIn(projectId: string) {
  const res = await env.post('/conversations', { surface: 'windows', projectId }, desktop);
  return res.json<{ id: string }>().id;
}

async function startRun(conversationId: string) {
  const res = await env.post(
    `/conversations/${conversationId}/messages`,
    { parts: [{ type: 'text', text: 'tambahkan tes untuk fungsi add' }] },
    desktop,
  );
  expect(res.statusCode, res.body).toBe(201);
  return SendMessageResponseSchema.parse(res.json()).run;
}

const getRun = async (id: string) =>
  RunSchema.parse((await env.get(`/runs/${id}`, desktop)).json());
const statusOf = async (id: string) => (await getRun(id)).status;
const problem = (res: { json(): unknown }) => ProblemSchema.parse(res.json());
const put = (path: string, payload: unknown, token = desktop) =>
  env.app.inject({
    method: 'PUT',
    url: `/v1${path}`,
    payload: payload as object,
    ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
  });
const workerOfProject = async (id: string) =>
  (
    await env.database.handle.db
      .select({ worker: projects.workerDeviceId })
      .from(projects)
      .where(eq(projects.id, id))
  )[0]?.worker;
const movedAudits = async (projectId: string) =>
  (await env.database.handle.db.select().from(auditLog)).filter(
    (r) => r.action === 'project.worker_moved' && r.target.startsWith(`project:${projectId} `),
  );

describe('worker didaftarkan ulang dengan nama sama (desktop login ulang)', () => {
  it('project pindah ke worker baru beserta audit; run, workspace.pending, dan tinjauan ikut worker baru', async () => {
    const old = await registerWorker('PC Ganti worker');
    await old.connect();
    const project = await createProject(old.deviceId, 'Project Ganti');
    const untouched = await createProject((await registerWorker('PC Lain worker')).deviceId, 'X');

    // Run worktree yang menunggu tinjauan di worker lama.
    const worktree = await startRun(await conversationIn(project.id));
    await until(() => old.all('run.start').some((c) => c.runId === worktree.id), 'run.start wt');
    old.emit(worktree.id, {
      type: 'workspace.ready',
      mode: 'worktree',
      branch: workerBranchFor(worktree.id),
      base: 'abc1234',
    });
    old.emit(worktree.id, { type: 'diff.updated', files: [file] });
    old.emit(worktree.id, { type: 'run.completed', summary: 'selesai' });
    await until(async () => (await statusOf(worktree.id)) === 'needs_review', 'needs_review wt');

    // Run in_place yang masih berjalan saat desktop login ulang.
    const inPlace = await startRun(await conversationIn(project.id));
    await until(() => old.all('run.start').some((c) => c.runId === inPlace.id), 'run.start ip');
    old.emit(inPlace.id, {
      type: 'workspace.ready',
      mode: 'in_place',
      branch: 'main',
      base: 'abc',
    });
    await until(async () => (await statusOf(inPlace.id)) === 'running', 'running ip');

    const fresh = await registerWorker('PC Ganti worker');

    expect(await workerOfProject(project.id)).toBe(fresh.deviceId);
    expect(await workerOfProject(untouched.id)).not.toBe(fresh.deviceId);
    expect((await movedAudits(project.id)).map((r) => r.target)).toEqual([
      `project:${project.id} device:${old.deviceId} -> device:${fresh.deviceId}`,
    ]);
    expect(await movedAudits(untouched.id)).toEqual([]);

    // Proses worker lama mati; worker baru tersambung dan melaporkan folder in_place dari workspaces.json.
    old.close();
    await fresh.connect();
    fresh.pending([{ runId: inPlace.id, files: [file] }]);
    await until(async () => (await statusOf(inPlace.id)) === 'needs_review', 'needs_review ip');
    expect((await getRun(inPlace.id)).error).toMatchObject({ code: 'worker_restarted' });
    await env.runner.idle();

    // Tinjauan run worktree dikirim ke worker baru.
    fresh.reply = (cmd) => ({
      type: 'review.result',
      runId: cmd.runId,
      decision: 'accept',
      ok: true,
      branch: workerBranchFor(cmd.runId),
      commit: 'a'.repeat(40),
      merged: false,
      mergeSkipped: null,
    });
    const reviewed = await env.post(`/runs/${worktree.id}/review`, { decision: 'accept' }, desktop);
    expect(reviewed.statusCode, reviewed.body).toBe(200);
    expect(fresh.all('review.apply').map((c) => c.runId)).toEqual([worktree.id]);
    expect(old.all('review.apply')).toEqual([]);

    // Run baru dimulai di worker baru.
    const next = await startRun(await conversationIn(project.id));
    await until(() => fresh.all('run.start').some((c) => c.runId === next.id), 'run.start baru');
    fresh.emit(next.id, { type: 'run.completed', summary: 'ok' });
    await until(async () => (await statusOf(next.id)) === 'completed', 'completed');
    fresh.close();
  });
});

describe('PUT /projects/:id/worker', () => {
  it('memindahkan project ke worker aktif lain dengan audit; worker yang sama tidak menulis audit', async () => {
    const from = await registerWorker('Rebind Asal');
    const to = await registerWorker('Rebind Tujuan');
    const project = await createProject(from.deviceId, 'Project Rebind');

    const res = await put(`/projects/${project.id}/worker`, { workerDeviceId: to.deviceId });

    expect(res.statusCode, res.body).toBe(200);
    expect(ProjectSchema.parse(res.json()).workerDeviceId).toBe(to.deviceId);
    expect(await workerOfProject(project.id)).toBe(to.deviceId);
    const again = await put(`/projects/${project.id}/worker`, { workerDeviceId: to.deviceId });
    expect(again.statusCode).toBe(200);
    expect((await movedAudits(project.id)).map((r) => r.target)).toEqual([
      `project:${project.id} device:${from.deviceId} -> device:${to.deviceId}`,
    ]);
  });

  it('validasi: body salah 400, bukan worker aktif 400 invalid_worker, project tidak ada 404', async () => {
    const worker = await registerWorker('Rebind Validasi');
    const project = await createProject(worker.deviceId, 'Project Validasi');
    const desktopId = (await env.loginOk({ kind: 'desktop', name: 'PC Rebind' })).device.id;
    const revoked = await registerWorker('Rebind Dicabut');
    await env.del(`/devices/${revoked.deviceId}`, desktop);

    expect((await put(`/projects/${project.id}/worker`, {})).statusCode).toBe(400);
    expect((await put(`/projects/${project.id}/worker`, { workerDeviceId: 'x' })).statusCode).toBe(
      400,
    );
    for (const workerDeviceId of [desktopId, MISSING, revoked.deviceId]) {
      const res = await put(`/projects/${project.id}/worker`, { workerDeviceId });
      expect(res.statusCode).toBe(400);
      expect(problem(res).code).toBe('invalid_worker');
    }
    const missing = await put(`/projects/${MISSING}/worker`, { workerDeviceId: worker.deviceId });
    expect(missing.statusCode).toBe(404);
    expect(await workerOfProject(project.id)).toBe(worker.deviceId);
  });

  it('auth: tanpa token 401, token worker 403', async () => {
    const worker = await registerWorker('Rebind Auth');
    const project = await createProject(worker.deviceId, 'Project Auth');
    const body = { workerDeviceId: worker.deviceId };

    expect((await put(`/projects/${project.id}/worker`, body, '')).statusCode).toBe(401);
    expect((await put(`/projects/${project.id}/worker`, body, worker.token)).statusCode).toBe(403);
    expect((await env.get(`/projects/${project.id}/worker`)).statusCode).toBe(401);
    expect((await env.get(`/projects/${project.id}/worker`, worker.token)).statusCode).toBe(403);
  });

  it('409 project_busy selama ada run berjalan; setelah run selesai pemindahan diterima', async () => {
    const from = await registerWorker('Rebind Sibuk');
    const to = await registerWorker('Rebind Sibuk Tujuan');
    await from.connect();
    const project = await createProject(from.deviceId, 'Project Sibuk');
    const run = await startRun(await conversationIn(project.id));
    await until(() => from.all('run.start').some((c) => c.runId === run.id), 'run.start');

    const busy = await put(`/projects/${project.id}/worker`, { workerDeviceId: to.deviceId });
    expect(busy.statusCode).toBe(409);
    expect(problem(busy).code).toBe('project_busy');
    expect(await workerOfProject(project.id)).toBe(from.deviceId);

    from.emit(run.id, { type: 'run.completed', summary: 'ok' });
    await until(async () => (await statusOf(run.id)) === 'completed', 'completed');
    await env.runner.idle();
    const ok = await put(`/projects/${project.id}/worker`, { workerDeviceId: to.deviceId });
    expect(ok.statusCode, ok.body).toBe(200);
    from.close();
  });
});

describe('GET /projects/:id/worker', () => {
  it('online mengikuti hub worker; worker dicabut = revoked dan tidak online; project tidak ada 404', async () => {
    const worker = await registerWorker('Status Worker');
    const project = await createProject(worker.deviceId, 'Project Status');
    const status = async () => {
      const res = await env.get(`/projects/${project.id}/worker`, desktop);
      expect(res.statusCode, res.body).toBe(200);
      return ProjectWorkerStatusSchema.parse(res.json());
    };

    expect(await status()).toMatchObject({
      workerDeviceId: worker.deviceId,
      name: 'Status Worker',
      online: false,
      revoked: false,
    });
    await worker.connect();
    expect((await status()).online).toBe(true);
    worker.close();
    await until(async () => !(await status()).online, 'offline');

    await worker.connect();
    await env.del(`/devices/${worker.deviceId}`, desktop);
    expect(await status()).toMatchObject({ online: false, revoked: true });
    worker.close();

    expect((await env.get(`/projects/${MISSING}/worker`, desktop)).statusCode).toBe(404);
  });
});
