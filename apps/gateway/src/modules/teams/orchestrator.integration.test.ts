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
import { createTeamOrchestrator } from './orchestrator.js';

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
const REVIEW_REVISE = [
  'Hampir, perbaiki dulu.',
  '```orca-review',
  '{"decision":"revise","feedback":"Tambah kasus edge."}',
  '```',
].join('\n');

/** Batas tim default untuk tes, dengan override per skenario. */
function limitsWith(overrides: Partial<Record<string, number>> = {}) {
  return {
    maxWorkers: 1,
    maxReviewRounds: 1,
    teamTimeoutMinutes: 5,
    memberTimeoutMinutes: 5,
    stepsPerMember: 50,
    tokensPerTeam: 100_000,
    tokensPerMember: 40_000,
    inputTokensPerCall: 20_000,
    outputTokensPerCall: 8_000,
    ...overrides,
  };
}

/** Membalas request Hermes berikutnya dengan teks biasa, lalu [DONE]. */
function replyHermes(text: string) {
  hermes.onRequest((stream) => {
    stream.delta(text);
    stream.finish();
    stream.done();
  });
}

describe('Orkestrator Orca: status tim selama perencanaan', () => {
  it('tim tidak pernah dilaporkan selesai/gagal di jendela antara Lead selesai dan rencana tersimpan', async () => {
    // Regresi flake e2e team.spec: sebelum rencana tersimpan, status diturunkan dari run Lead pertama; begitu
    // run itu 'completed' API melaporkan tim 'completed' padahal orkestrator belum membuat satu tugas pun,
    // dan klien yang mengambil detail di jendela itu terjebak pada "Tim selesai." tanpa tugas.
    const { fake, projectId } = await setupProject('orca-jendela');
    replyHermes(PLAN_ONE_TASK);
    const created = await env.post(
      '/teams',
      { projectId, prompt: 'Tambahkan tes untuk fungsi tambah.', limits: limitsWith() },
      desktop,
    );
    expect(created.statusCode, created.body).toBe(201);
    const team = TeamDetailSchema.parse(created.json());

    const seen: string[] = [];
    const deadline = Date.now() + 8000;
    let snapshot = await getTeam(team.id);
    // Pantau rapat (2 ms) sampai tugas pertama tercatat; semua status yang terlihat sebelumnya dikumpulkan.
    while (snapshot.assignments.length === 0) {
      seen.push(snapshot.status);
      if (Date.now() > deadline)
        throw new Error(`tugas tak kunjung tercatat; status: ${seen.join(',')}`);
      await sleep(2);
      snapshot = await getTeam(team.id);
    }
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.filter((s) => s !== 'running' && s !== 'queued')).toEqual([]);
    expect(snapshot.status).toBe('running');

    // Bersihkan: lepas Worker (slot Worker global hanya satu, tes berikutnya menunggu slot itu).
    await until(() => fake.all('run.start').length >= 1, 'run.start Worker');
    const workerCmd = fake.all('run.start')[0]!;
    const cancelled = await env.post(`/teams/${team.id}/cancel`, {}, desktop);
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    await until(
      async () => (await getRun(workerCmd.runId)).status === 'cancelled',
      'Worker cancelled',
    );
    expect((await getTeam(team.id)).status).toBe('cancelled');
  });
});

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

  it('Worker mati (tidak pernah merespons) -> batas waktu menghentikan run nyata, tim needs_attention', async () => {
    const { fake, projectId } = await setupProject('orca-mati');
    replyHermes(PLAN_ONE_TASK);

    const created = await env.post(
      '/teams',
      {
        projectId,
        prompt: 'Tugas dengan Worker mati.',
        limits: limitsWith({ memberTimeoutMinutes: 1 }),
      },
      desktop,
    );
    const team = TeamDetailSchema.parse(created.json());

    await until(() => fake.all('run.start').length >= 1, 'run.start Worker');
    const workerCmd = fake.all('run.start')[0]!;
    await until(async () => (await getRun(workerCmd.runId)).status === 'running', 'Worker running');

    // Worker tidak pernah membalas apa pun (koneksi WS tetap hidup, mesinnya "mati"). Majukan jam palsu
    // melewati memberTimeoutMinutes (1 menit) -- orkestrator harus mendeteksi lewat polling, bukan menunggu
    // jam sungguhan, dan MEMBATALKAN run secara nyata (bukan cuma asumsi di memori).
    env.clock.now += 2 * 60_000;

    await until(
      () => fake.all('run.cancel').some((c) => c.runId === workerCmd.runId),
      'run.cancel nyata terkirim ke Worker akibat batas waktu',
    );
    await until(
      async () => (await getTeam(team.id)).status === 'needs_attention',
      'tim needs_attention setelah Worker mati',
    );
    const finalTeam = await getTeam(team.id);
    expect(finalTeam.assignments[0]?.status).toBe('cancelled');
  });

  it('Worker lambat/kabur (melewati batas langkah) -> dihentikan nyata sebelum tokensCap/stepsCap terlampaui', async () => {
    const { fake, projectId } = await setupProject('orca-lambat');
    replyHermes(PLAN_ONE_TASK);

    const created = await env.post(
      '/teams',
      {
        projectId,
        prompt: 'Tugas dengan Worker kabur.',
        limits: limitsWith({ stepsPerMember: 3 }),
      },
      desktop,
    );
    const team = TeamDetailSchema.parse(created.json());

    await until(() => fake.all('run.start').length >= 1, 'run.start Worker');
    const workerCmd = fake.all('run.start')[0]!;
    await until(async () => (await getRun(workerCmd.runId)).status === 'running', 'Worker running');

    // Worker "kabur": terus melapor tool.started tanpa pernah menyelesaikan run. Setelah melewati
    // stepsPerMember (3), orkestrator harus menghentikannya nyata, bukan menunggu run.completed yang
    // tidak pernah datang.
    for (let i = 0; i < 5; i++) {
      fake.emit(workerCmd.runId, {
        type: 'tool.started',
        toolCallId: `t${i}`,
        name: 'command',
        target: `langkah ${i}`,
      });
    }

    await until(
      () => fake.all('run.cancel').some((c) => c.runId === workerCmd.runId),
      'run.cancel nyata terkirim ke Worker akibat batas langkah',
    );
    await until(
      async () => (await getTeam(team.id)).status === 'needs_attention',
      'tim needs_attention setelah Worker melewati batas langkah',
    );
  });

  it('Lead minta revisi -> percobaan kedua Worker, lalu Lead accept -> tim completed', async () => {
    const { fake, projectId } = await setupProject('orca-revisi');
    replyHermes(PLAN_ONE_TASK);

    const created = await env.post(
      '/teams',
      {
        projectId,
        prompt: 'Tugas yang butuh satu revisi.',
        limits: limitsWith({ maxReviewRounds: 1 }), // maxAttempts = maxReviewRounds + 1 = 2
      },
      desktop,
    );
    const team = TeamDetailSchema.parse(created.json());

    // Percobaan 1: Worker selesai, Lead minta revisi.
    await until(() => fake.all('run.start').length >= 1, 'run.start percobaan 1');
    const attempt1 = fake.all('run.start')[0]!;
    await until(
      async () => (await getRun(attempt1.runId)).status === 'running',
      'percobaan 1 running',
    );
    replyHermes(REVIEW_REVISE);
    fake.emit(attempt1.runId, {
      type: 'diff.updated',
      files: [{ path: 'math.test.js', additions: 2, deletions: 0 }],
    });
    fake.emit(attempt1.runId, { type: 'run.completed', summary: 'Percobaan 1.' });
    await until(
      async () => (await getRun(attempt1.runId)).status === 'needs_review',
      'percobaan 1 needs_review',
    );

    // Percobaan 2 (revisi): Worker lanjut dari worktree percobaan 1 (continueFromRunId), Lead accept.
    await until(
      () => fake.all('run.start').some((c) => c.continueFromRunId === attempt1.runId),
      'run.start percobaan 2 (revisi, continueFromRunId)',
    );
    const attempt2 = fake.all('run.start').find((c) => c.continueFromRunId === attempt1.runId)!;
    await until(
      async () => (await getRun(attempt2.runId)).status === 'running',
      'percobaan 2 running',
    );
    replyHermes(REVIEW_ACCEPT);
    fake.reply = (cmd) => acceptedResult(cmd.runId);
    fake.emit(attempt2.runId, {
      type: 'diff.updated',
      files: [{ path: 'math.test.js', additions: 4, deletions: 0 }],
    });
    fake.emit(attempt2.runId, { type: 'run.completed', summary: 'Percobaan 2, sudah diperbaiki.' });

    await until(
      async () => (await getTeam(team.id)).status === 'completed',
      'tim completed setelah revisi',
    );
    const finalTeam = await getTeam(team.id);
    expect(finalTeam.assignments[0]).toMatchObject({
      status: 'completed',
      reviewStatus: 'accept',
      attempt: 2,
    });
  });

  it('restart gateway: tim yang sedang berjalan ditandai needs_attention, TIDAK auto-resume', async () => {
    const { fake, projectId } = await setupProject('orca-restart');
    replyHermes(PLAN_ONE_TASK);

    const created = await env.post(
      '/teams',
      { projectId, prompt: 'Tugas yang akan ditinggal restart.', limits: limitsWith() },
      desktop,
    );
    const team = TeamDetailSchema.parse(created.json());

    await until(() => fake.all('run.start').length >= 1, 'run.start sebelum restart');
    const workerCmd = fake.all('run.start')[0]!;
    await until(
      async () => (await getRun(workerCmd.runId)).status === 'running',
      'running sebelum restart',
    );
    const commandsBeforeRestart = fake.commands.length;

    // Simulasikan gateway restart: proses orkestrator BARU (Map `running` kosong) terhadap DB yang sama,
    // seolah proses lama mati dan yang ini baru naik. start() harus menandai tim yang masih 'running'
    // sebagai needs_attention, TIDAK diam-diam melanjutkan/mengirim run.start baru (keputusan pemilik #7).
    const freshOrca = createTeamOrchestrator({
      db: env.database.handle.db,
      chat: env.chat,
      runs: env.runs,
      hub: env.hub,
      runEvents: env.store,
      store: env.teamStore,
      boss: env.boss!,
      now: () => env.clock.now,
      pollMs: 40,
    });
    await freshOrca.start();
    await freshOrca.close();

    const finalTeam = await getTeam(team.id);
    expect(finalTeam.status).toBe('needs_attention');
    expect(finalTeam.failureCode).toBe('gateway_restarted');
    expect(finalTeam.members.find((m) => m.role === 'worker')?.status).toBe('needs_attention');
    // Tidak ada run.start BARU dikirim ke Worker akibat restart (tidak auto-resume).
    expect(fake.commands.length).toBe(commandsBeforeRestart);
  });
});
