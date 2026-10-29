import {
  ApprovalSchema,
  GatewayToWorkerFrameSchema,
  LoginResponseSchema,
  ProblemSchema,
  RunSchema,
  SendMessageResponseSchema,
  workerBranchFor,
  type AgentEvent,
  type GatewayToWorkerFrame,
} from '@aios/contracts';
import { eq } from 'drizzle-orm';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { approvals, messages, runs } from '../../db/schema/index.js';
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
const MESSAGE_ID = '0192f0c4-7a1b-7c2d-a001-4a5b6c7d8e91';
let approvalSeq = 0;
// ID izin unik per tes (primary key approvals bersifat global).
let APPROVAL_ID = '';
beforeEach(() => {
  APPROVAL_ID = '0192f0c4-7a1b-7c2d-a002-' + String(++approvalSeq).padStart(12, '0');
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => boolean | Promise<boolean>, label: string, ms = 5000) {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > ms) throw new Error(`timeout menunggu ${label}`);
    await sleep(15);
  }
}

/** Worker tiruan: tersambung ke /v1/worker/ws, mencatat perintah gateway, dan mengirim event atas perintah tes. */
class FakeWorker {
  readonly commands: Extract<GatewayToWorkerFrame, { type: string }>[] = [];
  private socket!: WebSocket;
  constructor(
    private readonly token: string,
    readonly deviceId: string,
  ) {}

  async connect(): Promise<void> {
    this.socket = new WebSocket(url, { headers: { authorization: `Bearer ${this.token}` } });
    this.socket.on('message', (data: Buffer) => {
      this.commands.push(GatewayToWorkerFrameSchema.parse(JSON.parse(data.toString('utf8'))));
    });
    await new Promise<void>((resolve, reject) => {
      this.socket.once('open', resolve);
      this.socket.once('error', reject);
    });
  }

  emit(runId: string, event: AgentEvent) {
    this.socket.send(JSON.stringify({ type: 'run.event', runId, event }));
  }

  drop() {
    this.socket.terminate();
  }

  close() {
    this.socket?.terminate();
  }

  command<T extends string>(type: T) {
    return this.commands.find((c) => c.type === type) as
      Extract<GatewayToWorkerFrame, { type: T }> | undefined;
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
  const conversation = (
    await env.post('/conversations', { surface: 'windows', projectId: project.id }, desktop)
  ).json<{ id: string }>();
  const fake = new FakeWorker(worker.accessToken, worker.device.id);
  allWorkers.push(fake);
  if (connect) await fake.connect();
  return { fake, project, conversationId: conversation.id };
}

async function startRun(conversationId: string, text = 'tambahkan tes untuk fungsi add') {
  const res = await env.post(
    `/conversations/${conversationId}/messages`,
    { parts: [{ type: 'text', text }] },
    desktop,
  );
  expect(res.statusCode, res.body).toBe(201);
  return SendMessageResponseSchema.parse(res.json()).run;
}

const getRun = async (id: string) =>
  RunSchema.parse((await env.get(`/runs/${id}`, desktop)).json());
const statusOf = async (id: string) => (await getRun(id)).status;
const problem = (res: { json(): unknown }) => ProblemSchema.parse(res.json());

describe('skill di run coding', () => {
  it('skill spesialis dipilih dari kata kunci dan masuk ke bundel yang dikirim ke worker', async () => {
    const { fake, conversationId } = await setup('Worker Skill');
    const run = await startRun(
      conversationId,
      'ubah komponen tombol checkout dan perbaiki error-nya',
    );

    await until(() => fake.command('run.start') !== undefined, 'run.start di worker');
    const { systemPrompt } = fake.command('run.start')!.bundle;
    expect(systemPrompt).toContain('## ui-baseline');
    expect(systemPrompt).toContain('## diagnosing-bugs');
    expect(systemPrompt).not.toContain('## api-design');
    const reason = (await env.get(`/runs/${run.id}/events`, desktop)).body;
    expect(reason).toContain('Agent project dengan skill');
    fake.emit(run.id, { type: 'run.completed', summary: 's' });
    await until(async () => (await statusOf(run.id)) !== 'running', 'run selesai');
  });
});

describe('run coding lewat worker', () => {
  it('alur lengkap: run.start ke worker, minta izin, izinkan, selesai di needs_review dengan branch kerja', async () => {
    const { fake, conversationId, project } = await setup('Worker Alur');
    const run = await startRun(conversationId);

    await until(() => fake.command('run.start') !== undefined, 'run.start di worker');
    const start = fake.command('run.start')!;
    expect(start).toMatchObject({
      runId: run.id,
      projectId: project.id,
      prompt: 'tambahkan tes untuk fungsi add',
      bundle: { role: 'project' },
    });
    expect(start.bundle.systemPrompt).toContain('Aturan perilaku agent');
    expect(start.bundle.systemPrompt).toContain('Project');
    // Run coding menulis berkas di folder project di PC: tanpa aturan berkas server.
    expect(start.bundle.systemPrompt).not.toContain('# Berkas untuk pemilik');

    // Run ditandai coding di omp, lengkap dengan branch kerjanya.
    await until(async () => (await statusOf(run.id)) === 'running', 'running');
    expect(await getRun(run.id)).toMatchObject({
      kind: 'coding',
      engine: 'omp',
      branch: workerBranchFor(run.id),
    });

    fake.emit(run.id, {
      type: 'tool.started',
      toolCallId: 'call_1',
      name: 'bash',
      target: 'node --test',
    });
    fake.emit(run.id, {
      type: 'approval.requested',
      approvalId: APPROVAL_ID,
      kind: 'command',
      detail: 'node --test',
      cwd: 'C:\\work\\repo',
      toolCallId: 'call_1',
    });
    await until(async () => (await statusOf(run.id)) === 'waiting_approval', 'waiting_approval');
    const [pending] = await env.database.handle.db
      .select()
      .from(approvals)
      .where(eq(approvals.runId, run.id));
    expect(pending).toMatchObject({
      id: APPROVAL_ID,
      kind: 'command',
      detail: 'node --test',
      status: 'pending',
    });

    const decided = await env.post(
      `/runs/${run.id}/approvals/${APPROVAL_ID}`,
      { decision: 'allow', remember: true },
      desktop,
    );
    expect(decided.statusCode, decided.body).toBe(200);
    expect(ApprovalSchema.parse(decided.json())).toMatchObject({
      status: 'allowed',
      remember: true,
    });
    await until(() => fake.command('approval.resolve') !== undefined, 'approval.resolve di worker');
    expect(fake.command('approval.resolve')).toEqual({
      type: 'approval.resolve',
      runId: run.id,
      approvalId: APPROVAL_ID,
      decision: 'allow',
      remember: true,
    });

    fake.emit(run.id, {
      type: 'approval.resolved',
      approvalId: APPROVAL_ID,
      decision: 'allow',
      remember: false,
    });
    await until(async () => (await statusOf(run.id)) === 'running', 'kembali running');
    fake.emit(run.id, {
      type: 'tool.output',
      toolCallId: 'call_1',
      chunk: 'pass 1\n',
      stream: 'stdout',
    });
    fake.emit(run.id, {
      type: 'tool.finished',
      toolCallId: 'call_1',
      status: 'ok',
      durationMs: 420,
    });
    fake.emit(run.id, {
      type: 'message.delta',
      messageId: '0192f0c4-7a1b-7c2d-a009-000000000000',
      text: 'Tes ',
    });
    fake.emit(run.id, {
      type: 'message.delta',
      messageId: '0192f0c4-7a1b-7c2d-a009-000000000000',
      text: 'lulus.',
    });
    fake.emit(run.id, {
      type: 'diff.updated',
      files: [{ path: 'a.ts', additions: 1, deletions: 0 }],
    });
    fake.emit(run.id, { type: 'run.completed', summary: 'Tes lulus.' });

    // Run coding berhenti di needs_review (menunggu tinjauan diff), bukan completed. Baris DB final lebih dulu,
    // event penutupnya menyusul; tunggu run benar-benar selesai di runner sebelum membaca riwayat event.
    await until(async () => (await statusOf(run.id)) === 'needs_review', 'needs_review');
    await until(() => !env.runner.isActive(run.id), 'runner selesai');
    const [assistant] = (
      await env.database.handle.db.select().from(messages).where(eq(messages.runId, run.id))
    ).filter((m) => m.author === 'assistant');
    expect(assistant?.parts).toEqual([
      {
        type: 'tool',
        toolCallId: 'call_1',
        name: 'bash',
        target: 'node --test',
        status: 'ok',
        durationMs: 420,
      },
      { type: 'text', text: 'Tes lulus.' },
    ]);

    // Event tersimpan berurutan dan bisa diputar ulang; ID pesan delta = pesan asisten gateway.
    const events = (await env.get(`/runs/${run.id}/events?limit=500`, desktop))
      .json<{ items: { event: AgentEvent }[] }>()
      .items.map((i) => i.event);
    const types = events.map((e) => e.type);
    expect(types).toEqual(
      expect.arrayContaining([
        'route.decided',
        'tool.started',
        'approval.requested',
        'approval.resolved',
        'tool.finished',
        'run.completed',
      ]),
    );
    const deltaIds = new Set(
      events
        .filter((e) => e.type === 'message.delta')
        .map((e) => (e as { messageId: string }).messageId),
    );
    expect(deltaIds).toEqual(new Set([assistant?.id]));
    const statuses = events
      .filter((e) => e.type === 'run.status')
      .map((e) => (e as { status: string }).status);
    expect(statuses).toEqual([
      'queued',
      'routing',
      'preparing',
      'running',
      'waiting_approval',
      'running',
      'needs_review',
    ]);
    fake.close();
  });

  it('mode rencana: run.start membawa planOnly dan aturan rencana; selesai langsung completed tanpa tinjauan', async () => {
    const { fake, conversationId } = await setup('Worker Rencana');
    const res = await env.post(
      `/conversations/${conversationId}/messages`,
      { parts: [{ type: 'text', text: 'rencanakan dark mode' }], planOnly: true },
      desktop,
    );
    expect(res.statusCode, res.body).toBe(201);
    const run = SendMessageResponseSchema.parse(res.json()).run;

    await until(() => fake.command('run.start') !== undefined, 'run.start di worker');
    const start = fake.command('run.start')!;
    expect(start).toMatchObject({ runId: run.id, planOnly: true });
    expect(start.bundle.systemPrompt).toContain('# Mode rencana');
    await until(async () => (await statusOf(run.id)) === 'running', 'running');
    expect(await getRun(run.id)).toMatchObject({ kind: 'coding', planOnly: true });

    fake.emit(run.id, { type: 'message.delta', messageId: MESSAGE_ID, text: '1. Tambah tema.' });
    fake.emit(run.id, { type: 'run.completed', summary: 'Rencana siap.' });
    await until(async () => (await statusOf(run.id)) === 'completed', 'completed');
    fake.close();
  });

  it('run.start membawa riwayat percakapan dan konteks project di prompt sistem', async () => {
    const { fake, conversationId } = await setup('Worker Riwayat');
    const first = await startRun(conversationId);
    await until(() => fake.command('run.start') !== undefined, 'run.start pertama');
    fake.emit(first.id, {
      type: 'message.delta',
      messageId: MESSAGE_ID,
      text: 'Struktur: src/ dan api/.',
    });
    fake.emit(first.id, { type: 'run.completed', summary: 's' });
    await until(async () => (await statusOf(first.id)) === 'completed', 'completed');
    await env.runner.idle();

    const res = await env.post(
      `/conversations/${conversationId}/messages`,
      { parts: [{ type: 'text', text: 'lanjut ke fitur yang tadi' }] },
      desktop,
    );
    expect(res.statusCode, res.body).toBe(201);
    await until(
      () => fake.commands.filter((c) => c.type === 'run.start').length === 2,
      'run.start kedua',
    );
    const second = fake.commands.filter((c) => c.type === 'run.start')[1]!;
    expect(second.history?.map((h) => h.role)).toEqual(['user', 'assistant']);
    expect(second.history?.[1]?.content).toBe('Struktur: src/ dan api/.');
    expect(second.prompt).toBe('lanjut ke fitur yang tadi');
    expect(second.model).toBe('coding-main');
    expect(second.bundle.systemPrompt).toContain('# Project yang sedang dikerjakan');
    expect(second.bundle.systemPrompt).toContain('baca dulu berkas yang relevan');
    expect(second.bundle.systemPrompt).toContain('[saran]');
    fake.close();
  });

  it('model pilihan klien dikirim apa adanya di run.start ke worker (menggantikan model bawaan role)', async () => {
    const { fake, conversationId } = await setup('Worker Model');
    const res = await env.post(
      `/conversations/${conversationId}/messages`,
      { parts: [{ type: 'text', text: 'tambahkan tes untuk fungsi add' }], model: 'combo/pilihan' },
      desktop,
    );
    expect(res.statusCode, res.body).toBe(201);
    const run = SendMessageResponseSchema.parse(res.json()).run;
    await until(() => fake.command('run.start') !== undefined, 'run.start');

    expect(fake.command('run.start')?.model).toBe('combo/pilihan');
    expect((await getRun(run.id)).model).toBe('combo/pilihan');
    fake.close();
  });

  it('run coding tanpa perubahan berkas selesai completed, bukan needs_review', async () => {
    const { fake, conversationId } = await setup('Worker Tanya');
    const run = await startRun(conversationId);
    await until(() => fake.command('run.start') !== undefined, 'run.start');
    fake.emit(run.id, { type: 'message.delta', messageId: MESSAGE_ID, text: 'Jawaban saja.' });
    fake.emit(run.id, { type: 'diff.updated', files: [] });
    fake.emit(run.id, { type: 'run.completed', summary: 'Jawaban saja.' });
    await until(async () => (await statusOf(run.id)) === 'completed', 'completed');
    fake.close();
  });

  it('run biasa tidak membawa planOnly dan aturan rencana', async () => {
    const { fake, conversationId } = await setup('Worker Tanpa Rencana');
    const run = await startRun(conversationId);
    await until(() => fake.command('run.start') !== undefined, 'run.start');
    const start = fake.command('run.start')!;
    expect(start.planOnly).toBeUndefined();
    expect(start.bundle.systemPrompt).not.toContain('# Mode rencana');
    expect((await getRun(run.id)).planOnly).toBe(false);
    fake.close();
  });

  it('Tolak: keputusan deny diteruskan ke worker dan tercatat denied', async () => {
    const { fake, conversationId } = await setup('Worker Tolak');
    const run = await startRun(conversationId);
    await until(() => fake.command('run.start') !== undefined, 'run.start');
    fake.emit(run.id, {
      type: 'approval.requested',
      approvalId: APPROVAL_ID,
      kind: 'network',
      detail: 'https://x.test',
    });
    await until(async () => (await statusOf(run.id)) === 'waiting_approval', 'waiting_approval');

    const res = await env.post(
      `/runs/${run.id}/approvals/${APPROVAL_ID}`,
      { decision: 'deny' },
      desktop,
    );

    expect(ApprovalSchema.parse(res.json())).toMatchObject({ status: 'denied', remember: false });
    await until(() => fake.command('approval.resolve') !== undefined, 'approval.resolve');
    expect(fake.command('approval.resolve')).toMatchObject({ decision: 'deny', remember: false });
    fake.emit(run.id, {
      type: 'approval.resolved',
      approvalId: APPROVAL_ID,
      decision: 'deny',
      remember: false,
    });
    await until(async () => (await statusOf(run.id)) === 'running', 'running lagi');
    fake.close();
  });

  it('keputusan izin: tidak ada = 404, sudah diputuskan = 409, run lain = 404, tanpa token = 401', async () => {
    const { fake, conversationId } = await setup('Worker Galat');
    const run = await startRun(conversationId);
    await until(() => fake.command('run.start') !== undefined, 'run.start');
    fake.emit(run.id, {
      type: 'approval.requested',
      approvalId: APPROVAL_ID,
      kind: 'command',
      detail: 'ls',
    });
    await until(async () => (await statusOf(run.id)) === 'waiting_approval', 'waiting_approval');

    const missing = await env.post(
      `/runs/${run.id}/approvals/0192f0c4-7a1b-7c2d-a0ff-4a5b6c7d8eff`,
      { decision: 'allow' },
      desktop,
    );
    expect(missing.statusCode).toBe(404);
    expect(problem(missing).code).toBe('approval_not_found');

    expect(
      (await env.post(`/runs/${run.id}/approvals/${APPROVAL_ID}`, { decision: 'allow' }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await env.post(
          `/runs/${run.id}/approvals/${APPROVAL_ID}`,
          { decision: 'tidak-tahu' },
          desktop,
        )
      ).statusCode,
    ).toBe(400);

    expect(
      (await env.post(`/runs/${run.id}/approvals/${APPROVAL_ID}`, { decision: 'allow' }, desktop))
        .statusCode,
    ).toBe(200);
    const again = await env.post(
      `/runs/${run.id}/approvals/${APPROVAL_ID}`,
      { decision: 'deny' },
      desktop,
    );
    expect(again.statusCode).toBe(409);
    expect(problem(again).code).toBe('approval_already_resolved');
    fake.close();
  });

  it('worker tidak tersambung: run gagal dengan worker_offline dan pesan langkah berikutnya', async () => {
    const { conversationId } = await setup('Worker Mati', { connect: false });

    const run = await startRun(conversationId);

    await until(async () => (await statusOf(run.id)) === 'failed', 'failed');
    expect((await getRun(run.id)).error).toMatchObject({ code: 'worker_offline', retryable: true });
    expect((await getRun(run.id)).error?.message).toContain('aplikasi desktop');
  });

  it('worker melaporkan error: run gagal dengan kode dan pesan dari worker', async () => {
    const { fake, conversationId } = await setup('Worker Error');
    const run = await startRun(conversationId);
    await until(() => fake.command('run.start') !== undefined, 'run.start');

    fake.emit(run.id, {
      type: 'error',
      code: 'project_not_bound',
      message: 'Project belum terikat.',
      retryable: false,
    });

    await until(async () => (await statusOf(run.id)) === 'failed', 'failed');
    expect((await getRun(run.id)).error).toEqual({
      code: 'project_not_bound',
      message: 'Project belum terikat.',
      retryable: false,
    });
    fake.close();
  });

  it('cancel: run.cancel dikirim ke worker; worker mengonfirmasi dan run menjadi cancelled', async () => {
    const { fake, conversationId } = await setup('Worker Batal');
    const run = await startRun(conversationId);
    await until(() => fake.command('run.start') !== undefined, 'run.start');
    await until(async () => (await statusOf(run.id)) === 'running', 'running');

    const cancelling = env.post(`/runs/${run.id}/cancel`, {}, desktop);
    await until(() => fake.command('run.cancel') !== undefined, 'run.cancel');
    fake.emit(run.id, { type: 'run.status', status: 'cancelled' });

    expect((await cancelling).statusCode).toBe(200);
    expect(await statusOf(run.id)).toBe('cancelled');
    expect(fake.command('run.cancel')).toEqual({ type: 'run.cancel', runId: run.id });
    fake.close();
  });

  it('cancel saat worker diam: aliran ditutup paksa setelah masa tunggu dan run tetap cancelled', async () => {
    const { fake, conversationId } = await setup('Worker Diam');
    const run = await startRun(conversationId);
    await until(() => fake.command('run.start') !== undefined, 'run.start');
    await until(async () => (await statusOf(run.id)) === 'running', 'running');

    await env.post(`/runs/${run.id}/cancel`, {}, desktop);

    await until(async () => (await statusOf(run.id)) === 'cancelled', 'cancelled', 8000);
    fake.close();
  });

  it('steer diteruskan ke worker; steer pada run yang tidak aktif ditolak 409', async () => {
    const { fake, conversationId } = await setup('Worker Steer');
    const run = await startRun(conversationId);
    await until(() => fake.command('run.start') !== undefined, 'run.start');
    await until(async () => (await statusOf(run.id)) === 'running', 'running');

    const res = await env.post(`/runs/${run.id}/steer`, { text: 'fokus ke tes saja' }, desktop);

    expect(res.statusCode, res.body).toBe(204);
    await until(() => fake.command('run.steer') !== undefined, 'run.steer');
    expect(fake.command('run.steer')).toEqual({
      type: 'run.steer',
      runId: run.id,
      text: 'fokus ke tes saja',
    });

    fake.emit(run.id, {
      type: 'diff.updated',
      files: [{ path: 'a.ts', additions: 1, deletions: 0 }],
    });
    fake.emit(run.id, { type: 'run.completed', summary: 's' });
    await until(async () => (await statusOf(run.id)) === 'needs_review', 'needs_review');
    await until(() => !env.runner.isActive(run.id), 'runner selesai');
    const late = await env.post(`/runs/${run.id}/steer`, { text: 'terlambat' }, desktop);
    expect(late.statusCode).toBe(409);
    expect(problem(late).code).toBe('run_not_active');
    fake.close();
  });

  it('worker putus lebih lama dari masa tunggu: run gagal worker_disconnected', async () => {
    const { fake, conversationId } = await setup('Worker Putus');
    const run = await startRun(conversationId);
    await until(() => fake.command('run.start') !== undefined, 'run.start');
    await until(async () => (await statusOf(run.id)) === 'running', 'running');

    fake.drop();

    await until(async () => (await statusOf(run.id)) === 'failed', 'failed', 8000);
    expect((await getRun(run.id)).error).toMatchObject({
      code: 'worker_disconnected',
      retryable: true,
    });
  });

  it('worker putus sebentar lalu tersambung lagi: run berlanjut dan selesai', async () => {
    const { fake, conversationId } = await setup('Worker Kedip');
    const run = await startRun(conversationId);
    await until(() => fake.command('run.start') !== undefined, 'run.start');
    await until(async () => (await statusOf(run.id)) === 'running', 'running');

    fake.drop();
    await sleep(100);
    const again = new FakeWorker((fake as unknown as { token: string }).token, fake.deviceId);
    await again.connect();
    again.emit(run.id, { type: 'message.delta', messageId: MESSAGE_ID, text: 'Lanjut.' });
    again.emit(run.id, {
      type: 'diff.updated',
      files: [{ path: 'a.ts', additions: 1, deletions: 0 }],
    });
    again.emit(run.id, { type: 'run.completed', summary: 'Lanjut.' });

    await until(async () => (await statusOf(run.id)) === 'needs_review', 'needs_review');
    again.close();
  });

  it('percakapan tidak terblokir oleh run yang menunggu tinjauan: pesan baru diterima', async () => {
    const { fake, conversationId } = await setup('Worker Review');
    const first = await startRun(conversationId);
    await until(() => fake.command('run.start') !== undefined, 'run.start');
    fake.emit(first.id, {
      type: 'diff.updated',
      files: [{ path: 'a.ts', additions: 1, deletions: 0 }],
    });
    fake.emit(first.id, { type: 'run.completed', summary: 'selesai' });
    await until(async () => (await statusOf(first.id)) === 'needs_review', 'needs_review');

    const second = await startRun(conversationId, 'lanjutkan');

    expect(second.id).not.toBe(first.id);
    fake.close();
  });

  it('restart gateway: run yang menggantung ditandai gagal beserta izinnya, tetapi needs_review dibiarkan', async () => {
    const { conversationId } = await setup('Worker Pulih', { connect: false });
    const { db } = env.database.handle;
    const [hanging] = await db
      .insert(runs)
      .values({ kind: 'coding', engine: 'omp', status: 'waiting_approval', conversationId })
      .returning();
    const [review] = await db
      .insert(runs)
      .values({ kind: 'coding', engine: 'omp', status: 'needs_review', conversationId })
      .returning();
    await db.insert(approvals).values({
      id: '0192f0c4-7a1b-7c2d-a0aa-4a5b6c7d8e01',
      runId: hanging!.id,
      kind: 'command',
      detail: 'ls',
    });

    await env.runner.recoverOrphans();

    expect(await statusOf(hanging!.id)).toBe('failed');
    expect(await statusOf(review!.id)).toBe('needs_review');
    const [row] = await db.select().from(approvals).where(eq(approvals.runId, hanging!.id));
    expect(row?.status).toBe('cancelled');
  });
});
