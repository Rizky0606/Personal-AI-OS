import {
  GatewayToWorkerFrameSchema,
  LoginResponseSchema,
  ProblemSchema,
  TaskSchema,
  type AgentEvent,
  type GatewayToWorkerFrame,
  type ServerEvent,
  type Task,
  type WorkerReviewResultFrame,
} from '@aios/contracts';
import { eq } from 'drizzle-orm';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { runs, tasks } from '../../db/schema/index.js';
import { createAuthEnv, type AuthEnv } from '../../testing/auth-env.js';

let env: AuthEnv;
let desktop: string;
let url: string;
const userEvents: ServerEvent[] = [];
let stopUser: () => void;

beforeAll(async () => {
  env = await createAuthEnv(inject('testDatabaseUrl'), {
    workerRelay: { disconnectGraceMs: 400, cancelGraceMs: 300 },
    taskMaxParallel: 2,
  });
  desktop = (await env.loginOk({ kind: 'desktop' })).accessToken;
  await env.app.listen({ port: 0, host: '127.0.0.1' });
  url = `ws://127.0.0.1:${(env.app.server.address() as AddressInfo).port}/v1/worker/ws`;
  stopUser = env.hub.subscribe('user', ({ event }) => userEvents.push(event));
});
afterAll(async () => {
  stopUser();
  for (const worker of allWorkers) worker.close();
  await env.close();
});

const allWorkers: FakeWorker[] = [];
const stack = { languages: ['typescript'], frameworks: [] };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => boolean | Promise<boolean>, label: string, ms = 5000) {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > ms) throw new Error(`timeout menunggu ${label}`);
    await sleep(15);
  }
}

type Command = Extract<GatewayToWorkerFrame, { type: string }>;

/** Worker tiruan: mencatat perintah gateway dan menjawab `review.apply`. */
class FakeWorker {
  readonly commands: Command[] = [];
  private socket!: WebSocket;
  constructor(private readonly token: string) {}

  async connect(): Promise<void> {
    this.socket = new WebSocket(url, { headers: { authorization: `Bearer ${this.token}` } });
    this.socket.on('message', (data: Buffer) => {
      const frame = GatewayToWorkerFrameSchema.parse(JSON.parse(data.toString('utf8')));
      this.commands.push(frame);
      if (frame.type === 'review.apply') {
        const result: WorkerReviewResultFrame = {
          type: 'review.result',
          runId: frame.runId,
          decision: frame.decision,
          ok: true,
          branch: frame.decision === 'accept' ? 'aios/abcd1234' : '',
          commit: frame.decision === 'accept' ? 'a'.repeat(40) : null,
          merged: false,
          mergeSkipped: null,
        };
        this.socket.send(JSON.stringify(result));
      }
    });
    await new Promise<void>((resolve, reject) => {
      this.socket.once('open', resolve);
      this.socket.once('error', reject);
    });
  }

  emit(runId: string, event: AgentEvent) {
    this.socket.send(JSON.stringify({ type: 'run.event', runId, event }));
  }

  close() {
    this.socket?.terminate();
  }

  starts() {
    return this.commands.filter(
      (c): c is Extract<Command, { type: 'run.start' }> => c.type === 'run.start',
    );
  }
}

async function setup(name: string, { connect = true } = {}) {
  const worker = LoginResponseSchema.parse(
    (await env.post('/devices/worker', { name }, desktop)).json(),
  );
  const project = (
    await env.post(
      '/projects',
      { name: `Project ${name}`, workerDeviceId: worker.device.id, stack },
      desktop,
    )
  ).json<{ id: string }>();
  const fake = new FakeWorker(worker.accessToken);
  allWorkers.push(fake);
  if (connect) await fake.connect();
  return { fake, projectId: project.id };
}

const patch = (path: string, payload: object) =>
  env.app.inject({
    method: 'PATCH',
    url: `/v1${path}`,
    headers: { authorization: `Bearer ${desktop}` },
    payload,
  });

const create = async (projectId: string, title: string, extra: object = {}): Promise<Task> => {
  const res = await env.post('/tasks', { projectId, title, ...extra }, desktop);
  expect(res.statusCode, res.body).toBe(201);
  return TaskSchema.parse(res.json());
};

const board = async (projectId: string): Promise<Task[]> => {
  const res = await env.get(`/projects/${projectId}/tasks`, desktop);
  expect(res.statusCode, res.body).toBe(200);
  return res.json<{ items: unknown[] }>().items.map((t) => TaskSchema.parse(t));
};

const getTask = async (projectId: string, id: string) =>
  (await board(projectId)).find((t) => t.id === id)!;

const column = (tasks: Task[], status: Task['status']) =>
  tasks
    .filter((t) => t.status === status)
    .sort((a, b) => a.position - b.position)
    .map((t) => t.title);

const runTask = async (id: string, expectStatus = 200): Promise<Task> => {
  const res = await env.post(`/tasks/${id}/run`, {}, desktop);
  expect(res.statusCode, res.body).toBe(expectStatus);
  return TaskSchema.parse(res.json());
};

/** Menunggu worker menerima run.start untuk kartu ini, lalu mengembalikan runId-nya. */
async function started(fake: FakeWorker, projectId: string, taskId: string) {
  await until(async () => (await getTask(projectId, taskId)).runId !== null, 'runId kartu');
  const { runId } = await getTask(projectId, taskId);
  await until(() => fake.starts().some((c) => c.runId === runId), 'run.start');
  await until(
    async () =>
      (await env.get(`/runs/${runId}`, desktop)).json<{ status: string }>().status === 'running',
    'run running',
  );
  return runId!;
}

/** Menunggu kartu mencapai kolom ini (sinkronisasi dari run berjalan di latar belakang). */
const reach = (projectId: string, id: string, status: Task['status']) =>
  until(async () => (await getTask(projectId, id)).status === status, `kartu di ${status}`);

/** Agent selesai bekerja: diff lalu run.completed. */
async function finish(
  fake: FakeWorker,
  runId: string,
  files = [{ path: 'a.ts', additions: 4, deletions: 1 }],
) {
  fake.emit(runId, { type: 'diff.updated', files });
  fake.emit(runId, { type: 'run.completed', summary: 'Selesai' });
  await until(
    async () =>
      (await env.get(`/runs/${runId}`, desktop)).json<{ status: string }>().status ===
      'needs_review',
    'needs_review',
  );
}

describe('kartu kanban: papan dan urutan', () => {
  it('kartu baru masuk paling bawah kolomnya; seret mengubah kolom dan urutan, kolom dirapikan', async () => {
    const { projectId } = await setup('Papan', { connect: false });
    const a = await create(projectId, 'A');
    await create(projectId, 'B');
    const c = await create(projectId, 'C', { status: 'todo' });
    expect(column(await board(projectId), 'backlog')).toEqual(['A', 'B']);

    // A ke Todo di posisi paling atas; Backlog tinggal B (posisi 0).
    const moved = TaskSchema.parse(
      (await patch(`/tasks/${a.id}`, { status: 'todo', position: 0 })).json(),
    );
    expect(moved).toMatchObject({ status: 'todo', position: 0 });
    const now = await board(projectId);
    expect(column(now, 'todo')).toEqual(['A', 'C']);
    expect(column(now, 'backlog')).toEqual(['B']);
    expect(now.find((t) => t.title === 'B')?.position).toBe(0);
    expect(now.find((t) => t.id === c.id)?.position).toBe(1);

    // Urutan dalam kolom yang sama (alternatif keyboard: geser naik/turun).
    await patch(`/tasks/${a.id}`, { position: 1 });
    expect(column(await board(projectId), 'todo')).toEqual(['C', 'A']);
  });

  it('Running dan Review hanya diisi sistem; role harus role coding; project harus ada', async () => {
    const { projectId } = await setup('Aturan', { connect: false });
    const a = await create(projectId, 'A');

    const toRunning = await patch(`/tasks/${a.id}`, { status: 'running' });
    expect(toRunning.statusCode).toBe(400);
    expect(ProblemSchema.parse(toRunning.json()).code).toBe('status_managed');
    expect(
      (await env.post('/tasks', { projectId, title: 'X', status: 'review' }, desktop)).statusCode,
    ).toBe(400);

    const general = await patch(`/tasks/${a.id}`, { agentRole: 'general' });
    expect(general.statusCode).toBe(400);
    expect(ProblemSchema.parse(general.json()).code).toBe('role_not_coding');
    const okRole = TaskSchema.parse(
      (await patch(`/tasks/${a.id}`, { agentRole: 'frontend' })).json(),
    );
    expect(okRole.agentRole).toBe('frontend');

    const missing = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';
    expect((await env.get(`/projects/${missing}/tasks`, desktop)).statusCode).toBe(404);
    expect((await env.post('/tasks', { projectId: missing, title: 'X' }, desktop)).statusCode).toBe(
      404,
    );
    expect((await patch(`/tasks/${missing}`, { title: 'Y' })).statusCode).toBe(404);
  });

  it('perubahan kartu disiarkan di channel user sebagai task.updated', async () => {
    const { projectId } = await setup('Siaran', { connect: false });
    const before = userEvents.length;
    const card = await create(projectId, 'Disiarkan');
    await patch(`/tasks/${card.id}`, { title: 'Disiarkan ulang' });
    const seen = userEvents
      .slice(before)
      .flatMap((e) => (e.type === 'task.updated' ? [e.task.title] : []));
    expect(seen).toEqual(['Disiarkan', 'Disiarkan ulang']);
  });
});

describe('Kerjakan dengan AI', () => {
  it('kartu pindah ke Running, run coding dibuat di worker, lalu otomatis ke Review dengan diff stat dan branch', async () => {
    const { fake, projectId } = await setup('Kerjakan');
    const card = await create(projectId, 'Tambah tombol', { body: 'Di header.\n\n- rata kanan' });

    const running = await runTask(card.id);
    expect(running.status).toBe('running');
    expect(running.runId).not.toBeNull();
    // Role belum dipilih dan router tidak terjangkau di tes: role coding bawaan terisi dan tampil di chip.
    expect(running.agentRole).toBe('backend');

    const runId = await started(fake, projectId, card.id);
    const start = fake.starts().find((c) => c.runId === runId)!;
    expect(start.prompt).toBe('Tambah tombol\n\nDi header.\n\n- rata kanan');
    expect(start.bundle.role).toBe('backend');
    const [run] = await env.database.handle.db.select().from(runs).where(eq(runs.id, runId));
    expect(run).toMatchObject({ taskId: card.id, kind: 'coding', engine: 'omp' });

    await finish(fake, runId);
    await reach(projectId, card.id, 'review');
    const reviewing = await getTask(projectId, card.id);
    expect(reviewing).toMatchObject({
      status: 'review',
      runId,
      diffStat: { files: 1, additions: 4, deletions: 1 },
    });
    expect(reviewing.branch).toMatch(/^aios\//);

    // Terima di panel Diff -> kartu Done.
    const accepted = await env.post(`/runs/${runId}/review`, { decision: 'accept' }, desktop);
    expect(accepted.statusCode, accepted.body).toBe(200);
    await reach(projectId, card.id, 'done');
  });

  it('kartu yang sedang dikerjakan tidak bisa dipindah atau dikerjakan lagi; kartu Done tidak bisa dikerjakan', async () => {
    const { fake, projectId } = await setup('Terkunci');
    const card = await create(projectId, 'Kunci');
    await runTask(card.id);
    await started(fake, projectId, card.id);

    const drag = await patch(`/tasks/${card.id}`, { status: 'todo' });
    expect(drag.statusCode).toBe(409);
    expect(ProblemSchema.parse(drag.json()).code).toBe('task_running');
    const again = await env.post(`/tasks/${card.id}/run`, {}, desktop);
    expect(again.statusCode).toBe(409);
    expect(ProblemSchema.parse(again.json()).code).toBe('task_not_runnable');

    const done = await create(projectId, 'Selesai', { status: 'done' });
    expect((await env.post(`/tasks/${done.id}/run`, {}, desktop)).statusCode).toBe(409);
  });

  it('role yang dipilih pada kartu dipakai apa adanya', async () => {
    const { fake, projectId } = await setup('Role Kartu');
    const card = await create(projectId, 'Ubah gaya', { agentRole: 'frontend' });
    await runTask(card.id);
    const runId = await started(fake, projectId, card.id);
    expect(fake.starts().find((c) => c.runId === runId)?.bundle.role).toBe('frontend');
  });

  it('run gagal atau dibatalkan mengembalikan kartu ke Todo dan mengirim notifikasi error', async () => {
    const { fake, projectId } = await setup('Gagal');
    const card = await create(projectId, 'Gagal dikerjakan');
    await runTask(card.id);
    const runId = await started(fake, projectId, card.id);
    const before = userEvents.length;

    fake.emit(runId, {
      type: 'error',
      code: 'model_error',
      message: 'Model gagal',
      retryable: false,
    });
    await until(
      async () => (await getTask(projectId, card.id)).status === 'todo',
      'kartu kembali ke Todo',
    );
    expect(
      userEvents
        .slice(before)
        .some(
          (e) =>
            e.type === 'notification' &&
            e.level === 'error' &&
            e.title.includes('Gagal dikerjakan'),
        ),
    ).toBe(true);

    // Bisa dikerjakan lagi.
    const second = await runTask(card.id);
    expect(second.status).toBe('running');
    const secondRun = await started(fake, projectId, card.id);
    expect(secondRun).not.toBe(runId);
    const cancel = await env.post(`/runs/${secondRun}/cancel`, {}, desktop);
    expect(cancel.statusCode, cancel.body).toBe(200);
    await until(
      async () => (await getTask(projectId, card.id)).status === 'todo',
      'Todo setelah batal',
    );
  });

  it('tolak dengan komentar: kartu tetap Running dengan run revisi, lalu kembali ke Review', async () => {
    const { fake, projectId } = await setup('Revisi');
    const card = await create(projectId, 'Perlu revisi', { agentRole: 'frontend' });
    await runTask(card.id);
    const first = await started(fake, projectId, card.id);
    await finish(fake, first);
    await reach(projectId, card.id, 'review');

    const res = await env.post(
      `/runs/${first}/review`,
      { decision: 'reject', comments: [{ path: 'a.ts', line: 2, body: 'Pakai ===' }] },
      desktop,
    );
    expect(res.statusCode, res.body).toBe(200);
    const revisionId = res.json<{ revisionRunId: string }>().revisionRunId;
    await until(
      async () => (await getTask(projectId, card.id)).runId === revisionId,
      'kartu pindah ke run revisi',
    );
    expect((await getTask(projectId, card.id)).status).toBe('running');

    await started(fake, projectId, card.id);
    await finish(fake, revisionId);
    await reach(projectId, card.id, 'review');
    expect(await getTask(projectId, card.id)).toMatchObject({
      status: 'review',
      runId: revisionId,
    });
  });

  it('tolak tanpa komentar mengembalikan kartu ke Todo', async () => {
    const { fake, projectId } = await setup('Tolak');
    const card = await create(projectId, 'Akan ditolak', { agentRole: 'backend' });
    await runTask(card.id);
    const runId = await started(fake, projectId, card.id);
    await finish(fake, runId);
    await reach(projectId, card.id, 'review');

    expect(
      (await env.post(`/runs/${runId}/review`, { decision: 'reject' }, desktop)).statusCode,
    ).toBe(200);
    await reach(projectId, card.id, 'todo');
  });
});

describe('start ulang gateway', () => {
  it('kartu yang tertinggal di Running disamakan dengan status run-nya', async () => {
    const { fake, projectId } = await setup('Restart');
    const card = await create(projectId, 'Tertinggal', { agentRole: 'backend' });
    await runTask(card.id);
    const runId = await started(fake, projectId, card.id);
    await finish(fake, runId);
    await reach(projectId, card.id, 'review');
    // Sinkronisasi latar belakang harus tuntas dulu, agar tidak menimpa kondisi buatan di bawah.
    await env.tasks.idle();

    // Gateway mati sebelum kartu sempat pindah: kartu masih Running padahal run sudah menunggu tinjauan.
    await env.database.handle.db
      .update(tasks)
      .set({ status: 'running' })
      .where(eq(tasks.id, card.id));
    expect((await getTask(projectId, card.id)).status).toBe('running');

    await env.tasks.start();

    await reach(projectId, card.id, 'review');
  });
});

describe('batas run paralel', () => {
  it('dua kartu berjalan paralel; yang ketiga mengantre lalu dimulai saat ada slot', async () => {
    const { fake, projectId } = await setup('Paralel');
    const a = await create(projectId, 'Kartu A', { agentRole: 'frontend' });
    const b = await create(projectId, 'Kartu B', { agentRole: 'backend' });
    const c = await create(projectId, 'Kartu C', { agentRole: 'backend' });

    const ra = await runTask(a.id);
    const rb = await runTask(b.id);
    const rc = await runTask(c.id);
    expect(ra.runId).not.toBeNull();
    expect(rb.runId).not.toBeNull();
    expect(ra.runId).not.toBe(rb.runId);
    // C menunggu: ada di Running tetapi belum punya run.
    expect(rc).toMatchObject({ status: 'running', runId: null });
    await until(() => fake.starts().length === 2, 'dua run.start');

    // Dua run berjalan bersamaan; masing-masing punya run sendiri dan branch-nya sendiri.
    const runA = await started(fake, projectId, a.id);
    const runB = await started(fake, projectId, b.id);
    const stateA = await getTask(projectId, a.id);
    const stateB = await getTask(projectId, b.id);
    expect(stateA.branch).not.toBeNull();
    expect(stateA.branch).not.toBe(stateB.branch);
    expect(column(await board(projectId), 'running')).toEqual(['Kartu A', 'Kartu B', 'Kartu C']);

    // A selesai -> slot kosong -> C dimulai otomatis.
    await finish(fake, runA);
    await until(async () => (await getTask(projectId, c.id)).runId !== null, 'C dimulai');
    const runC = await started(fake, projectId, c.id);
    expect(
      fake
        .starts()
        .map((s) => s.runId)
        .sort(),
    ).toEqual([runA, runB, runC].sort());
    await reach(projectId, a.id, 'review');

    // Kartu antrean bisa dibatalkan dengan memindahkannya keluar Running.
    // Urutan di kolom mengikuti kedatangan, jadi B dan C diselesaikan satu per satu (bukan bersamaan),
    // supaya urutannya pasti di runner CI yang lambat maupun mesin cepat.
    await finish(fake, runB);
    await reach(projectId, b.id, 'review');
    await finish(fake, runC);
    await reach(projectId, c.id, 'review');
    expect(column(await board(projectId), 'review')).toEqual(['Kartu A', 'Kartu B', 'Kartu C']);
  });

  it('kartu antrean boleh dipindah keluar dari Running (batal menunggu)', async () => {
    const { fake, projectId } = await setup('Batal Antre');
    const one = await create(projectId, 'Satu', { agentRole: 'backend' });
    const two = await create(projectId, 'Dua', { agentRole: 'backend' });
    const three = await create(projectId, 'Tiga', { agentRole: 'backend' });
    await runTask(one.id);
    await runTask(two.id);
    const queued = await runTask(three.id);
    expect(queued.runId).toBeNull();
    await started(fake, projectId, one.id);
    await started(fake, projectId, two.id);

    const back = TaskSchema.parse((await patch(`/tasks/${three.id}`, { status: 'todo' })).json());
    expect(back).toMatchObject({ status: 'todo', runId: null });
    expect(fake.starts()).toHaveLength(2);
  });

  it('antrean jalan terpisah per project', async () => {
    const first = await setup('Project Satu');
    const second = await setup('Project Dua');
    const cards = [
      await create(first.projectId, 'P1-A', { agentRole: 'backend' }),
      await create(first.projectId, 'P1-B', { agentRole: 'backend' }),
      await create(second.projectId, 'P2-A', { agentRole: 'backend' }),
    ];
    for (const card of cards) expect((await runTask(card.id)).runId).not.toBeNull();
  });
});

describe('POST /tasks/breakdown', () => {
  it('project tidak ada → 404; ide kosong → 400', async () => {
    const missing = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';
    const none = await env.post(
      '/tasks/breakdown',
      { projectId: missing, idea: 'sesuatu' },
      desktop,
    );
    expect(none.statusCode).toBe(404);
    const { projectId } = await setup('Pecah', { connect: false });
    expect((await env.post('/tasks/breakdown', { projectId, idea: '' }, desktop)).statusCode).toBe(
      400,
    );
  });

  it('model tidak terjangkau → 502 dengan pesan yang bisa ditindaklanjuti', async () => {
    const { projectId } = await setup('Pecah Offline', { connect: false });
    const res = await env.post(
      '/tasks/breakdown',
      { projectId, idea: 'Buat halaman login' },
      desktop,
    );
    expect(res.statusCode).toBe(502);
    expect(ProblemSchema.parse(res.json()).code).toBe('router_unavailable');
  });
});
