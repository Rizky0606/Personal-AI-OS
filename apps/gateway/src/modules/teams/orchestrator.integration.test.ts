import {
  GatewayToWorkerFrameSchema,
  LoginResponseSchema,
  RunSchema,
  TeamDetailSchema,
  type AgentEvent,
  type GatewayToWorkerFrame,
  type WorkerReviewResultFrame,
} from '@aios/contracts';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { createAuthEnv, type AuthEnv } from '../../testing/auth-env.js';
import { startFakeHermes, type FakeHermes } from '../../testing/fake-hermes.js';

/**
 * Tes integrasi orkestrator Orca (ORCA_DESIGN.md, Tahap 1) dengan Postgres, pg-boss, dan WebSocket
 * worker NYATA (bukan mock jaringan) + Hermes dan Worker TIRUAN (fake-hermes.ts, FakeWorker di bawah --
 * sama persis dengan pola apps/gateway/src/modules/runs/review.integration.test.ts).
 */

let env: AuthEnv;
let hermes: FakeHermes;
let desktop: string;
let url: string;

beforeAll(async () => {
  hermes = await startFakeHermes();
  env = await createAuthEnv(inject('testDatabaseUrl'), {
    teams: { pollMs: 40, globalWorkerSlots: 1 },
    hermesUrl: hermes.url,
    workerRelay: { disconnectGraceMs: 400, cancelGraceMs: 300 },
  });
  desktop = (await env.loginOk({ kind: 'desktop' })).accessToken;
  await env.app.listen({ port: 0, host: '127.0.0.1' });
  url = `ws://127.0.0.1:${(env.app.server.address() as AddressInfo).port}/v1/worker/ws`;
});
afterAll(async () => {
  for (const worker of allWorkers) worker.close();
  await hermes.close();
  await env.close();
});
afterEach(() => {
  hermes.requests.length = 0;
});

const allWorkers: FakeWorker[] = [];
const stack = { languages: ['typescript'], frameworks: [] };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => boolean | Promise<boolean>, label: string, ms = 8000) {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > ms) throw new Error(`timeout menunggu ${label}`);
    await sleep(20);
  }
}

type Command = Extract<GatewayToWorkerFrame, { type: string }>;

/** Worker tiruan: sama persis dengan review.integration.test.ts (sumber kebenaran protokol worker). */
class FakeWorker {
  readonly commands: Command[] = [];
  reply: ((cmd: Extract<Command, { type: 'review.apply' }>) => WorkerReviewResultFrame) | undefined;
  private socket!: WebSocket;
  constructor(
    private readonly token: string,
    readonly deviceId: string,
  ) {}

  async connect(): Promise<void> {
    this.socket = new WebSocket(url, { headers: { authorization: `Bearer ${this.token}` } });
    this.socket.on('message', (data: Buffer) => {
      const frame = GatewayToWorkerFrameSchema.parse(JSON.parse(data.toString('utf8')));
      this.commands.push(frame);
      if (frame.type === 'review.apply' && this.reply) {
        this.socket.send(JSON.stringify(this.reply(frame)));
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

  all<T extends Command['type']>(type: T) {
    return this.commands.filter((c) => c.type === type) as Extract<Command, { type: T }>[];
  }
}

async function setupProject(name: string) {
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
  const fake = new FakeWorker(worker.accessToken, worker.device.id);
  allWorkers.push(fake);
  await fake.connect();
  return { fake, projectId: project.id };
}

const getRun = async (id: string) =>
  RunSchema.parse((await env.get(`/runs/${id}`, desktop)).json());
const getTeam = async (id: string) =>
  TeamDetailSchema.parse((await env.get(`/teams/${id}`, desktop)).json());

const acceptedResult = (runId: string): WorkerReviewResultFrame => ({
  type: 'review.result',
  runId,
  decision: 'accept',
  ok: true,
  branch: 'aios/orca/worker',
  commit: 'a'.repeat(40),
  merged: false,
  mergeSkipped: null,
});
const rejectedResult = (runId: string): WorkerReviewResultFrame => ({
  type: 'review.result',
  runId,
  decision: 'reject',
  ok: true,
  branch: '',
  commit: null,
  merged: false,
  mergeSkipped: null,
});

const PLAN_ONE_TASK = [
  'Rencana: satu tugas untuk Worker.',
  '```orca-plan',
  JSON.stringify({
    tasks: [
      {
        title: 'Tambah tes matematika',
        prompt: 'Tambahkan tes untuk fungsi tambah.',
        acceptanceCriteria: 'Tes baru ada dan lulus.',
      },
    ],
  }),
  '```',
].join('\n');

const REVIEW_ACCEPT = [
  'Hasil memenuhi kriteria.',
  '```orca-review',
  '{"decision":"accept","feedback":"Bagus."}',
  '```',
].join('\n');
const REVIEW_REJECT = [
  'Tidak layak diteruskan.',
  '```orca-review',
  '{"decision":"reject","feedback":"Keluar scope."}',
  '```',
].join('\n');

/** Membalas request Hermes berikutnya dengan teks biasa, lalu [DONE]. */
function replyHermes(text: string) {
  hermes.onRequest((stream) => {
    stream.delta(text);
    stream.finish();
    stream.done();
  });
}

describe('Orkestrator Orca: siklus hidup dasar', () => {
  it('rencana satu tugas -> Worker selesai -> Lead accept -> tim completed, hasil tidak digabung', async () => {
    const { fake, projectId } = await setupProject('orca-sukses');
    replyHermes(PLAN_ONE_TASK);

    const created = await env.post(
      '/teams',
      {
        projectId,
        prompt: 'Tambahkan tes untuk fungsi tambah.',
        limits: {
          maxWorkers: 1,
          maxReviewRounds: 1,
          teamTimeoutMinutes: 5,
          memberTimeoutMinutes: 5,
          stepsPerMember: 50,
          tokensPerTeam: 100_000,
          tokensPerMember: 40_000,
          inputTokensPerCall: 20_000,
          outputTokensPerCall: 8_000,
        },
      },
      desktop,
    );
    expect(created.statusCode, created.body).toBe(201);
    const team = TeamDetailSchema.parse(created.json());

    // Worker menerima run.start untuk assignment (bukan run Lead, yang lewat Hermes).
    await until(() => fake.all('run.start').length >= 1, 'run.start Worker');
    const workerCmd = fake.all('run.start')[0]!;
    await until(async () => (await getRun(workerCmd.runId)).status === 'running', 'Worker running');

    fake.emit(workerCmd.runId, {
      type: 'diff.updated',
      files: [{ path: 'math.test.js', additions: 5, deletions: 0 }],
    });
    fake.emit(workerCmd.runId, { type: 'run.completed', summary: 'Tes ditambahkan.' });
    // Siapkan jawaban tinjauan Lead SEBELUM request kedua tiba -- fake-hermes.ts hanya punya satu slot
    // handler yang langsung dipakai begitu request masuk (bukan antrean), jadi harus sudah terpasang
    // sebelum orkestrator mengirim permintaan tinjauan, bukan sesudah menunggu requests.length naik.
    replyHermes(REVIEW_ACCEPT);
    fake.reply = (cmd) => acceptedResult(cmd.runId);
    await until(
      async () => (await getRun(workerCmd.runId)).status === 'needs_review',
      'Worker needs_review',
    );

    await until(async () => (await getTeam(team.id)).status === 'completed', 'tim completed');
    const finalTeam = await getTeam(team.id);
    expect(finalTeam.assignments).toHaveLength(1);
    expect(finalTeam.assignments[0]).toMatchObject({
      status: 'completed',
      reviewStatus: 'accept',
      resultRef: 'a'.repeat(40),
    });
    // Larangan keras: tidak ada review.apply dengan merge:true (tidak pernah auto-gabung ke project).
    for (const cmd of fake.all('review.apply')) expect(cmd.merge).toBe(false);
  });

  it('Lead menolak hasil Worker -> assignment failed, tim needs_attention, tidak ada merge', async () => {
    const { fake, projectId } = await setupProject('orca-tolak');
    replyHermes(PLAN_ONE_TASK);

    const created = await env.post(
      '/teams',
      {
        projectId,
        prompt: 'Tugas yang akan ditolak Lead.',
        limits: {
          maxWorkers: 1,
          maxReviewRounds: 1,
          teamTimeoutMinutes: 5,
          memberTimeoutMinutes: 5,
          stepsPerMember: 50,
          tokensPerTeam: 100_000,
          tokensPerMember: 40_000,
          inputTokensPerCall: 20_000,
          outputTokensPerCall: 8_000,
        },
      },
      desktop,
    );
    const team = TeamDetailSchema.parse(created.json());

    await until(() => fake.all('run.start').length >= 1, 'run.start Worker');
    const workerCmd = fake.all('run.start')[0]!;
    await until(async () => (await getRun(workerCmd.runId)).status === 'running', 'Worker running');
    fake.emit(workerCmd.runId, {
      type: 'diff.updated',
      files: [{ path: 'wrong.js', additions: 1, deletions: 0 }],
    });
    fake.emit(workerCmd.runId, { type: 'run.completed', summary: 'Salah arah.' });
    replyHermes(REVIEW_REJECT);
    fake.reply = (cmd) => rejectedResult(cmd.runId);
    await until(
      async () => (await getRun(workerCmd.runId)).status === 'needs_review',
      'Worker needs_review',
    );

    await until(
      async () => (await getTeam(team.id)).status === 'needs_attention',
      'tim needs_attention',
    );
    const finalTeam = await getTeam(team.id);
    expect(finalTeam.assignments[0]).toMatchObject({ status: 'failed', reviewStatus: 'reject' });
    expect(fake.all('review.apply').every((c) => c.merge === false)).toBe(true);
  });

  it('pembatalan tim merambat: Worker yang sedang berjalan ikut dibatalkan', async () => {
    const { fake, projectId } = await setupProject('orca-batal');
    replyHermes(PLAN_ONE_TASK);

    const created = await env.post(
      '/teams',
      {
        projectId,
        prompt: 'Tugas yang akan dibatalkan.',
        limits: {
          maxWorkers: 1,
          maxReviewRounds: 1,
          teamTimeoutMinutes: 5,
          memberTimeoutMinutes: 5,
          stepsPerMember: 50,
          tokensPerTeam: 100_000,
          tokensPerMember: 40_000,
          inputTokensPerCall: 20_000,
          outputTokensPerCall: 8_000,
        },
      },
      desktop,
    );
    const team = TeamDetailSchema.parse(created.json());

    await until(() => fake.all('run.start').length >= 1, 'run.start Worker');
    const workerCmd = fake.all('run.start')[0]!;
    await until(async () => (await getRun(workerCmd.runId)).status === 'running', 'Worker running');

    const cancelRes = await env.post(`/teams/${team.id}/cancel`, {}, desktop);
    expect(cancelRes.statusCode, cancelRes.body).toBe(200);

    // Pembatalan merambat ke Worker: perintah run.cancel sungguhan terkirim ke Worker untuk run itu.
    await until(
      () => fake.all('run.cancel').some((c) => c.runId === workerCmd.runId),
      'run.cancel terkirim ke Worker',
    );
    await until(
      async () => (await getRun(workerCmd.runId)).status === 'cancelled',
      'Worker cancelled',
    );
    const finalTeam = await getTeam(team.id);
    expect(finalTeam.status).toBe('cancelled');
  });
});
