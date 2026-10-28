import {
  GatewayToWorkerFrameSchema,
  LoginResponseSchema,
  ProblemSchema,
  ReviewResponseSchema,
  RunSchema,
  SendMessageResponseSchema,
  type AgentEvent,
  type GatewayToWorkerFrame,
  type WorkerReviewResultFrame,
} from '@aios/contracts';
import { eq } from 'drizzle-orm';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { runEvents } from '../../db/schema/index.js';
import { createAuthEnv, type AuthEnv } from '../../testing/auth-env.js';
import { bundleComments } from './service.js';

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => boolean | Promise<boolean>, label: string, ms = 5000) {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > ms) throw new Error(`timeout menunggu ${label}`);
    await sleep(15);
  }
}

type Command = Extract<GatewayToWorkerFrame, { type: string }>;

/** Worker tiruan: mencatat perintah gateway dan menjawab `review.apply` sesuai skenario tes. */
class FakeWorker {
  readonly commands: Command[] = [];
  /** Jawaban otomatis untuk review.apply; undefined = tidak menjawab. */
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
  return { fake, conversationId: conversation.id };
}

const getRun = async (id: string) =>
  RunSchema.parse((await env.get(`/runs/${id}`, desktop)).json());

/** Satu run coding sampai needs_review (agent sudah selesai bekerja). */
async function reviewable(fake: FakeWorker, conversationId: string, text = 'tambahkan tes') {
  const sent = await env.post(
    `/conversations/${conversationId}/messages`,
    { parts: [{ type: 'text', text }] },
    desktop,
  );
  expect(sent.statusCode, sent.body).toBe(201);
  const run = SendMessageResponseSchema.parse(sent.json()).run;
  await until(() => fake.all('run.start').some((c) => c.runId === run.id), 'run.start');
  await until(async () => (await getRun(run.id)).status === 'running', 'running');
  fake.emit(run.id, {
    type: 'diff.updated',
    files: [{ path: 'math.test.js', additions: 3, deletions: 0 }],
  });
  fake.emit(run.id, { type: 'run.completed', summary: 'Selesai' });
  await until(async () => (await getRun(run.id)).status === 'needs_review', 'needs_review');
  await env.runner.idle();
  return run;
}

const review = (runId: string, body: unknown) => env.post(`/runs/${runId}/review`, body, desktop);
const problem = (res: { json(): unknown }) => ProblemSchema.parse(res.json());
const accepted = (runId: string): WorkerReviewResultFrame => ({
  type: 'review.result',
  runId,
  decision: 'accept',
  ok: true,
  branch: 'aios/abcd1234',
  commit: 'a'.repeat(40),
  merged: true,
  mergeSkipped: null,
});

describe('POST /runs/:id/review', () => {
  it('terima: worker menerima keputusan dan pesan commit; run menjadi accepted dengan event status', async () => {
    const { fake, conversationId } = await setup('Review Terima');
    const run = await reviewable(fake, conversationId);
    fake.reply = (cmd) => ({ ...accepted(cmd.runId), branch: `aios/${cmd.runId.slice(-8)}` });

    const res = await review(run.id, {
      decision: 'accept',
      merge: true,
      commitMessage: 'test: tambah tes',
    });

    expect(res.statusCode, res.body).toBe(200);
    const body = ReviewResponseSchema.parse(res.json());
    expect(body).toMatchObject({ merged: true, mergeSkipped: null, revisionRunId: null });
    expect(body.run.status).toBe('accepted');
    expect(body.commit).toBe('a'.repeat(40));
    expect(fake.all('review.apply')).toEqual([
      {
        type: 'review.apply',
        runId: run.id,
        decision: 'accept',
        comments: [],
        merge: true,
        commitMessage: 'test: tambah tes',
      },
    ]);
    expect((await getRun(run.id)).status).toBe('accepted');
    const events = await env.database.handle.db
      .select()
      .from(runEvents)
      .where(eq(runEvents.runId, run.id));
    expect(events.map((e) => e.payload)).toContainEqual({ type: 'run.status', status: 'accepted' });
    expect(events.map((e) => e.payload.type)).toContain('diff.updated');
  });

  it('terima tanpa merge: merge=false diteruskan; alasan merge dilewati dikembalikan ke klien', async () => {
    const { fake, conversationId } = await setup('Review Dilewati');
    const run = await reviewable(fake, conversationId);
    fake.reply = (cmd) => ({ ...accepted(cmd.runId), merged: false, mergeSkipped: 'dirty' });

    const res = await review(run.id, { decision: 'accept', merge: true });

    expect(ReviewResponseSchema.parse(res.json())).toMatchObject({
      merged: false,
      mergeSkipped: 'dirty',
      run: { status: 'accepted' },
    });
  });

  it('tolak tanpa komentar: worker membuang hasil; run menjadi rejected', async () => {
    const { fake, conversationId } = await setup('Review Tolak');
    const run = await reviewable(fake, conversationId);
    fake.reply = (cmd) => ({
      type: 'review.result',
      runId: cmd.runId,
      decision: 'reject',
      ok: true,
      branch: '',
      commit: null,
      merged: false,
      mergeSkipped: null,
    });

    const res = await review(run.id, { decision: 'reject' });

    expect(res.statusCode, res.body).toBe(200);
    expect(ReviewResponseSchema.parse(res.json()).run.status).toBe('rejected');
    expect(fake.all('review.apply')[0]).toMatchObject({ decision: 'reject', comments: [] });
  });

  it('tolak dengan komentar: run baru melanjutkan worktree yang sama, komentar dibundel satu pesan', async () => {
    const { fake, conversationId } = await setup('Review Komentar');
    const run = await reviewable(fake, conversationId);
    const comments = [
      { path: 'src/math.js', line: 12, body: 'Pakai === bukan ==' },
      { path: 'math.test.js', line: 3, body: 'Tambah kasus\nnegatif' },
    ];

    const res = await review(run.id, { decision: 'reject', comments });

    expect(res.statusCode, res.body).toBe(200);
    const body = ReviewResponseSchema.parse(res.json());
    expect(body.run.status).toBe('rejected');
    expect(body.revisionRunId).not.toBeNull();
    // Tidak ada review.apply: worktree dipertahankan untuk run lanjutan.
    expect(fake.all('review.apply')).toEqual([]);
    const revisionId = body.revisionRunId!;
    await until(
      () => fake.all('run.start').some((c) => c.runId === revisionId),
      'run.start revisi',
    );
    const start = fake.all('run.start').find((c) => c.runId === revisionId)!;
    expect(start.continueFromRunId).toBe(run.id);
    expect(start.prompt).toBe(bundleComments(comments));
    expect(start.prompt).toContain('- src/math.js:12 — Pakai === bukan ==');
    expect(start.prompt).toContain('- math.test.js:3 — Tambah kasus negatif');
    expect(start.bundle.role).toBe('project');
    // Branch yang sama dengan run sebelumnya.
    await until(async () => (await getRun(revisionId)).status === 'running', 'revisi running');
    expect((await getRun(revisionId)).branch).toBe((await getRun(run.id)).branch);

    fake.emit(revisionId, {
      type: 'diff.updated',
      files: [{ path: 'math.test.js', additions: 1, deletions: 0 }],
    });
    fake.emit(revisionId, { type: 'run.completed', summary: 'Diperbaiki' });
    await until(async () => (await getRun(revisionId)).status === 'needs_review', 'revisi selesai');
  });

  it('terima dengan komentar ditolak (400); komentar tanpa isi ditolak oleh validasi', async () => {
    const { fake, conversationId } = await setup('Review Salah');
    const run = await reviewable(fake, conversationId);

    const mixed = await review(run.id, {
      decision: 'accept',
      comments: [{ path: 'a.ts', line: 1, body: 'x' }],
    });
    const empty = await review(run.id, {
      decision: 'reject',
      comments: [{ path: 'a.ts', line: 0, body: '' }],
    });

    expect(mixed.statusCode).toBe(400);
    expect(empty.statusCode).toBe(400);
    expect((await getRun(run.id)).status).toBe('needs_review');
  });

  it('run yang tidak menunggu tinjauan: 409 run_not_reviewable; run tidak dikenal: 404', async () => {
    const { fake, conversationId } = await setup('Review Status');
    const run = await reviewable(fake, conversationId);
    fake.reply = (cmd) => accepted(cmd.runId);
    expect((await review(run.id, { decision: 'accept' })).statusCode).toBe(200);

    const again = await review(run.id, { decision: 'accept' });

    expect(again.statusCode).toBe(409);
    expect(problem(again).code).toBe('run_not_reviewable');
    expect(fake.all('review.apply')).toHaveLength(1);
    expect(
      (await review('0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f', { decision: 'accept' })).statusCode,
    ).toBe(404);
  });

  it('worker offline: 503 worker_offline dan run tetap menunggu tinjauan', async () => {
    const { fake, conversationId } = await setup('Review Offline');
    const run = await reviewable(fake, conversationId);
    fake.close();
    await sleep(100);

    const res = await review(run.id, { decision: 'accept' });

    expect(res.statusCode).toBe(503);
    expect(problem(res).code).toBe('worker_offline');
    expect((await getRun(run.id)).status).toBe('needs_review');
  });

  it('worker gagal menerapkan: 409 review_failed dengan pesan worker; run tetap menunggu tinjauan', async () => {
    const { fake, conversationId } = await setup('Review Gagal');
    const run = await reviewable(fake, conversationId);
    fake.reply = (cmd) => ({
      ...accepted(cmd.runId),
      ok: false,
      commit: null,
      merged: false,
      error: 'Hasil run ini sudah tidak ada di PC ini.',
    });

    const res = await review(run.id, { decision: 'accept' });

    expect(res.statusCode).toBe(409);
    expect(problem(res)).toMatchObject({
      code: 'review_failed',
      detail: expect.stringContaining('sudah tidak ada') as string,
    });
    expect((await getRun(run.id)).status).toBe('needs_review');
  });

  it('dua keputusan bersamaan: hanya satu yang berlaku', async () => {
    const { fake, conversationId } = await setup('Review Ganda');
    const run = await reviewable(fake, conversationId);
    fake.reply = (cmd) => accepted(cmd.runId);

    const [a, b] = await Promise.all([
      review(run.id, { decision: 'accept' }),
      review(run.id, { decision: 'accept' }),
    ]);

    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    expect((await getRun(run.id)).status).toBe('accepted');
  });
});

describe('bundleComments', () => {
  it('memuat path, baris, dan isi komentar per baris, satu komentar per butir', () => {
    expect(
      bundleComments([
        { path: 'a.ts', line: 1, body: 'satu' },
        { path: 'b/c.ts', line: 20, body: '  dua\n\ndan tiga ' },
      ]).split('\n'),
    ).toEqual([
      'Saya meninjau perubahan Anda dan ada komentar pada baris tertentu.',
      'Perbaiki hanya bagian yang dikomentari dan jangan ubah bagian lain.',
      'Nomor baris merujuk ke versi berkas saat ini (setelah perubahan Anda).',
      '',
      '- a.ts:1 — satu',
      '- b/c.ts:20 — dua dan tiga',
    ]);
  });
});
