import {
  ConversationSchema,
  EngineListSchema,
  ProblemSchema,
  RunSchema,
  SendMessageResponseSchema,
  type AgentEvent,
} from '@aios/contracts';
import { eq } from 'drizzle-orm';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { messages, runEvents } from '../../db/schema/index.js';
import { createAuthEnv, type AuthEnv } from '../../testing/auth-env.js';
import type { DshDeps } from './launch.js';

/**
 * Engine dsh dari ujung ke ujung di gateway: pesan dengan `engine: 'dsh'` meluncurkan proses ACP palsu
 * (testing/fake-dsh.mjs) lewat peluncur produksi (createDshEngine), lengkap dengan lingkungan dan folder kerja.
 */
const FAKE = fileURLToPath(new URL('../../testing/fake-dsh.mjs', import.meta.url));
const KEY = 'kunci-9router-uji';

let env: AuthEnv;
let envOff: AuthEnv;
let root: string;
let token: string;
let tokenOff: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'aios-dsh-gw-'));
  const config: DshDeps['config'] = {
    DSH_COMMAND: process.execPath,
    DSH_ARGS: FAKE,
    DSH_HOME: undefined,
    DSH_WORKDIR_ROOT: root,
    DSH_UID: undefined,
    DSH_GID: undefined,
    DSH_MAX_MEMORY_MB: 512,
    DSH_RUN_TIMEOUT_MS: 60_000,
    DSH_IDLE_TIMEOUT_MS: 30_000,
    DSH_APPROVAL_TIMEOUT_MS: 30_000,
    NINEROUTER_API_KEY: KEY,
  };
  env = await createAuthEnv(inject('testDatabaseUrl'), { dsh: config });
  envOff = await createAuthEnv(inject('testDatabaseUrl'));
  token = (await env.loginOk({ kind: 'desktop' })).accessToken;
  tokenOff = (await envOff.loginOk({ kind: 'desktop' })).accessToken;
});
afterAll(async () => {
  await env.close();
  await envOff.close();
  await rm(root, { recursive: true, force: true });
});

const until = async <T>(read: () => Promise<T>, ok: (v: T) => boolean, ms = 30_000): Promise<T> => {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = await read();
    if (ok(v) || Date.now() > deadline) return v;
    await new Promise((r) => setTimeout(r, 20));
  }
};

async function send(target: AuthEnv, accessToken: string, text: string) {
  const conv = ConversationSchema.parse(
    (await target.post('/conversations', { surface: 'windows' }, accessToken)).json(),
  );
  const res = await target.post(
    `/conversations/${conv.id}/messages`,
    { parts: [{ type: 'text', text }], engine: 'dsh' },
    accessToken,
  );
  expect(res.statusCode, res.body).toBe(201);
  return SendMessageResponseSchema.parse(res.json());
}

const getRun = (target: AuthEnv, accessToken: string, id: string) =>
  target.get(`/runs/${id}`, accessToken).then((r) => RunSchema.parse(r.json()));

const events = async (target: AuthEnv, runId: string): Promise<AgentEvent[]> =>
  (
    await target.database.handle.db
      .select()
      .from(runEvents)
      .where(eq(runEvents.runId, runId))
      .orderBy(runEvents.seq)
  ).map((r) => r.payload);

/** Run final dan event penutupnya sudah tertulis. */
async function finalRun(target: AuthEnv, accessToken: string, id: string) {
  const run = await until(
    () => getRun(target, accessToken, id),
    (r) => ['completed', 'failed', 'cancelled'].includes(r.status),
  );
  await until(
    async () => (await events(target, id)).at(-1),
    (e) => e?.type === 'run.status' && e.status === run.status,
  );
  return run;
}

const assistantText = async (target: AuthEnv, runId: string) => {
  const rows = await target.database.handle.db
    .select()
    .from(messages)
    .where(eq(messages.runId, runId));
  const parts = rows.find((r) => r.author === 'assistant')?.parts ?? [];
  return parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('');
};

const pendingApproval = async (runId: string) => {
  const found = await until(
    async () => (await events(env, runId)).find((e) => e.type === 'approval.requested'),
    (e) => e !== undefined,
  );
  if (found?.type !== 'approval.requested') throw new Error('approval.requested tidak muncul');
  return found;
};

describe('engine dsh di gateway', () => {
  it('GET /engines: tersedia bila dikonfigurasi, tidak bila tidak', async () => {
    const on = EngineListSchema.parse((await env.get('/engines', token)).json());
    const off = EngineListSchema.parse((await envOff.get('/engines', tokenOff)).json());
    expect(on.items).toEqual([
      { id: 'dsh', label: 'DeepSeek Harness (dsh)', available: true, experimental: true },
    ]);
    expect(off.items[0]).toMatchObject({ id: 'dsh', available: false });
  });

  it('run selesai lewat ACP: engine dsh tercatat, teks tersimpan, event berurutan', async () => {
    const { run } = await send(env, token, 'sapa');
    const done = await finalRun(env, token, run.id);
    expect(done).toMatchObject({ status: 'completed', engine: 'dsh' });
    expect(await assistantText(env, run.id)).toBe('halo dari dsh');
    const types = (await events(env, run.id)).map((e) => e.type);
    expect(types).toContain('message.delta');
    expect(types.at(-1)).toBe('run.status');
    expect(types.filter((t) => t === 'run.completed')).toHaveLength(1);
  });

  it('proses dsh hanya mendapat lingkungan minimal, kunci 9Router, dan folder kerja run', async () => {
    const { run } = await send(env, token, 'env');
    await finalRun(env, token, run.id);
    const info = JSON.parse(await assistantText(env, run.id)) as Record<string, unknown>;
    expect(info).toMatchObject({
      hasDatabaseUrl: false,
      hasAuthSecret: false,
      llmKey: KEY,
      nodeOptions: '--max-old-space-size=512',
    });
    expect(String(info.cwd).replaceAll('\\', '/')).toContain(
      `${root.replaceAll('\\', '/')}/${run.id}`.replace(/^[A-Za-z]:/, ''),
    );
  });

  it('izin diminta, disetujui lewat API, lalu run selesai', async () => {
    const { run } = await send(env, token, 'izin');
    const approval = await pendingApproval(run.id);
    expect(approval.kind).toBe('command');
    expect(approval.detail).toContain('rm -rf build');
    expect((await getRun(env, token, run.id)).status).toBe('waiting_approval');
    const res = await env.post(
      `/runs/${run.id}/approvals/${approval.approvalId}`,
      { decision: 'allow' },
      token,
    );
    expect(res.statusCode, res.body).toBeLessThan(300);
    expect((await finalRun(env, token, run.id)).status).toBe('completed');
    expect(await assistantText(env, run.id)).toBe('diizinkan');
  });

  it('izin ditolak: tool denied, agent diberi tahu', async () => {
    const { run } = await send(env, token, 'izin');
    const approval = await pendingApproval(run.id);
    await env.post(`/runs/${run.id}/approvals/${approval.approvalId}`, { decision: 'deny' }, token);
    expect((await finalRun(env, token, run.id)).status).toBe('completed');
    expect(await assistantText(env, run.id)).toBe('ditolak');
    const finished = (await events(env, run.id)).find((e) => e.type === 'tool.finished');
    expect(finished).toMatchObject({ status: 'denied' });
  });

  it('cancel saat agent berjalan: status cancelled, tanpa error', async () => {
    const { run } = await send(env, token, 'macet');
    await until(
      async () => (await events(env, run.id)).some((e) => e.type === 'message.delta'),
      Boolean,
    );
    const res = await env.post(`/runs/${run.id}/cancel`, {}, token);
    expect(res.statusCode, res.body).toBeLessThan(300);
    const done = await finalRun(env, token, run.id);
    expect(done.status).toBe('cancelled');
    expect((await events(env, run.id)).some((e) => e.type === 'error')).toBe(false);
  });

  it('proses mati di tengah run: gagal dengan acp_exited, tidak menggantung', async () => {
    const { run } = await send(env, token, 'mati');
    const done = await finalRun(env, token, run.id);
    expect(done.status).toBe('failed');
    expect(done.error).toMatchObject({ code: 'acp_exited', retryable: true });
  });

  it('tanpa DSH_COMMAND: run gagal dengan engine_unavailable', async () => {
    const { run } = await send(envOff, tokenOff, 'sapa');
    const done = await finalRun(envOff, tokenOff, run.id);
    expect(done.status).toBe('failed');
    expect(done.error).toMatchObject({ code: 'engine_unavailable', retryable: false });
  });

  it('engine selain dsh ditolak oleh skema', async () => {
    const conv = ConversationSchema.parse(
      (await env.post('/conversations', { surface: 'windows' }, token)).json(),
    );
    const res = await env.post(
      `/conversations/${conv.id}/messages`,
      { parts: [{ type: 'text', text: 'x' }], engine: 'omp' },
      token,
    );
    expect(res.statusCode).toBe(400);
    expect(ProblemSchema.safeParse(res.json()).success).toBe(true);
  });
});
