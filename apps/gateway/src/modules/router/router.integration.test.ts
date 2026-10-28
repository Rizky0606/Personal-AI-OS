import {
  AgentEventSchema,
  ConversationSchema,
  RunSchema,
  SendMessageResponseSchema,
  type AgentEvent,
} from '@aios/contracts';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { projects, routingDecisions, runEvents } from '../../db/schema/index.js';
import { createAuthEnv, type AuthEnv } from '../../testing/auth-env.js';
import { startFakeHermes, type FakeHermes } from '../../testing/fake-hermes.js';
import { startMockServer, type MockServer } from '../../testing/mock-server.js';
import { SERVER_FILES_RULE, SUGGEST_RULE } from '../runs/runner.js';

let env: AuthEnv;
let hermes: FakeHermes;
let nine: MockServer;
let token: string;
let projectId: string;

/** Pesan sistem run chat di server: bundel agent (dengan skill tambahan) lalu aturan berkas untuk pemilik. */
const serverPrompt = (extraSkills: string[] = []) =>
  [env.roles.bundle('general', extraSkills).systemPrompt, SUGGEST_RULE, SERVER_FILES_RULE].join(
    '\n\n',
  );

beforeAll(async () => {
  hermes = await startFakeHermes();
  // Judul otomatis dibuat gagal supaya tidak ikut campur (jatuh ke 6 kata pertama).
  nine = await startMockServer((_req, res) => void res.writeHead(500).end());
  env = await createAuthEnv(inject('testDatabaseUrl'), {
    hermesUrl: hermes.url,
    ninerouterUrl: `${nine.url}/v1`,
  });
  token = (await env.loginOk({ kind: 'desktop' })).accessToken;
  const worker = await env.loginOk({ kind: 'worker', name: 'PC worker' });
  const [project] = await env.database.handle.db
    .insert(projects)
    .values({
      name: 'toko-online',
      workerDeviceId: worker.device.id,
      stack: { languages: ['typescript'], frameworks: ['react', 'fastify'] },
    })
    .returning();
  projectId = project!.id;
});
afterAll(async () => {
  await env.close();
  await hermes.close();
  await nine.close();
});
beforeEach(() => {
  hermes.requests.length = 0;
  hermes.onRequest((s) => {
    s.delta('ok');
    s.finish();
    s.done();
  });
});

const db = () => env.database.handle.db;

const conversation = async (body: object = { surface: 'android' }) =>
  ConversationSchema.parse((await env.post('/conversations', body, token)).json());
const send = async (conversationId: string, text: string, extra: object = {}) => {
  const res = await env.post(
    `/conversations/${conversationId}/messages`,
    { parts: [{ type: 'text', text }], ...extra },
    token,
  );
  expect(res.statusCode, res.body).toBe(201);
  return SendMessageResponseSchema.parse(res.json());
};
const until = async <T>(read: () => Promise<T>, ok: (v: T) => boolean, ms = 30_000): Promise<T> => {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = await read();
    if (ok(v) || Date.now() > deadline) return v;
    await new Promise((r) => setTimeout(r, 20));
  }
};
const events = async (runId: string): Promise<AgentEvent[]> =>
  (
    await db().select().from(runEvents).where(eq(runEvents.runId, runId)).orderBy(runEvents.seq)
  ).map((r) => r.payload);
const settle = async (runId: string) => {
  const run = await until(
    async () => RunSchema.parse((await env.get(`/runs/${runId}`, token)).json()),
    (r) => ['completed', 'failed', 'cancelled'].includes(r.status),
  );
  await until(
    async () => (await events(runId)).at(-1),
    (e) => e?.type === 'run.status' && e.status === run.status,
  );
  return run;
};
const systemOf = (index = 0) => hermes.requests[index]!.body.messages[0]!.content;

describe('agent tetap tanpa router', () => {
  it('chat umum memakai agent umum; route.decided dan keputusan tersimpan, tanpa memanggil model', async () => {
    const conv = await conversation();
    const { message, run } = await send(conv.id, 'Apa bedanya TCP dan UDP?');
    const done = await settle(run.id);

    expect(done).toMatchObject({ status: 'completed', agentRole: 'general', engine: 'hermes' });
    const all = await events(run.id);
    for (const e of all) expect(AgentEventSchema.safeParse(e).success).toBe(true);
    expect(all.find((e) => e.type === 'route.decided')).toEqual({
      type: 'route.decided',
      role: 'general',
      confidence: 1,
      reason: 'Agent umum, tanpa skill tambahan.',
    });
    const [row] = await db()
      .select()
      .from(routingDecisions)
      .where(eq(routingDecisions.messageId, message.id));
    expect(row).toMatchObject({ role: 'general', confidence: 1 });
    expect(systemOf()).toBe(serverPrompt());
  });

  it('skill spesialis dipilih dari kata kunci pesan dan ikut masuk ke system prompt', async () => {
    const conv = await conversation();
    const { run } = await send(
      conv.id,
      'Tolong riset dan bandingkan dua framework, sebut sumbernya',
    );
    await settle(run.id);

    const decided = (await events(run.id)).find((e) => e.type === 'route.decided');
    expect(decided).toMatchObject({
      role: 'general',
      reason: 'Agent umum dengan skill source-verification, citation, fact-vs-opinion.',
    });
    expect(systemOf()).toBe(serverPrompt(['source-verification', 'citation', 'fact-vs-opinion']));
  });

  it('skills menambah dan skillsOff mencabut skill; skill tak dikenal diabaikan', async () => {
    const conv = await conversation();
    const { run } = await send(conv.id, 'Tolong riset dan bandingkan dua framework', {
      skills: ['stop-slop', 'skill-hantu'],
      skillsOff: ['citation'],
    });
    await settle(run.id);

    expect(systemOf()).toBe(serverPrompt(['source-verification', 'fact-vs-opinion', 'stop-slop']));
    expect(systemOf()).not.toContain('## citation\n');
  });

  it('percakapan Android dengan project tetap agent umum; paket skill kode tidak ikut', async () => {
    const conv = await conversation({ surface: 'android', projectId });
    const { run } = await send(conv.id, 'buat komponen tombol dan endpoint baru');
    const done = await settle(run.id);

    expect(done).toMatchObject({ agentRole: 'general', engine: 'hermes' });
    expect(systemOf()).toBe(serverPrompt());
  });

  it('role tidak lagi diterima di pesan: GET /roles hanya menampilkan agent tetap', async () => {
    const res = await env.get('/roles', token);
    expect(res.statusCode).toBe(200);
    const ids = res.json<{ items: { id: string }[] }>().items.map((r) => r.id);
    expect(ids).toEqual(['general', 'project', 'researcher']);
    expect(
      (await env.post('/route/preview', { message: 'x', surface: 'android' }, token)).statusCode,
    ).toBe(404);
  });
});
