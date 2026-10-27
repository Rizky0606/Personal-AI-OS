import {
  AgentEventSchema,
  ConversationSchema,
  ProblemSchema,
  RerouteResponseSchema,
  RouteDecisionSchema,
  RunSchema,
  SendMessageResponseSchema,
  type AgentEvent,
} from '@aios/contracts';
import { count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import {
  messages,
  projects,
  routingCorrections,
  routingDecisions,
  runEvents,
  runs,
} from '../../db/schema/index.js';
import { createAuthEnv, type AuthEnv } from '../../testing/auth-env.js';
import { startFakeHermes, type FakeHermes } from '../../testing/fake-hermes.js';
import { startMockServer, type MockServer } from '../../testing/mock-server.js';
import { SERVER_FILES_RULE, SUGGEST_RULE } from '../runs/runner.js';

interface RouterCall {
  model: string;
  temperature: number;
  system: string;
  user: string;
}
interface RouterAnswer {
  status?: number;
  content?: string;
}

/** Pesan sistem run chat di server: bundel role lalu aturan berkas untuk pemilik. */
const serverPrompt = (role: string) =>
  [env.roles.bundle(role).systemPrompt, SUGGEST_RULE, SERVER_FILES_RULE].join('\n\n');

let env: AuthEnv;
let hermes: FakeHermes;
let nine: MockServer;
let token: string;
let projectId: string;
const routerCalls: RouterCall[] = [];
let routerAnswer: (call: RouterCall, n: number) => RouterAnswer | Promise<RouterAnswer>;

const route = (role: string, confidence = 0.9, extra: Record<string, unknown> = {}) => ({
  content: JSON.stringify({
    role,
    confidence,
    reason: `memilih ${role}`,
    needs_split: false,
    subtasks: [],
    ...extra,
  }),
});

beforeAll(async () => {
  hermes = await startFakeHermes();
  nine = await startMockServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      void (async () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          model: string;
          temperature: number;
          messages: { role: string; content: string }[];
        };
        const system = body.messages[0]?.content ?? '';
        if (!system.includes('Kamu router')) {
          // Judul otomatis: dibuat gagal supaya tidak ikut campur (jatuh ke 6 kata pertama).
          res.writeHead(500).end();
          return;
        }
        const call: RouterCall = {
          model: body.model,
          temperature: body.temperature,
          system,
          user: body.messages.at(-1)?.content ?? '',
        };
        routerCalls.push(call);
        const answer = await routerAnswer(call, routerCalls.length);
        if (res.destroyed) return;
        if (answer.status && answer.status !== 200) {
          res.writeHead(answer.status).end();
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' }).end(
          JSON.stringify({
            choices: [{ message: { role: 'assistant', content: answer.content } }],
          }),
        );
      })();
    });
  });
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
  routerCalls.length = 0;
  hermes.requests.length = 0;
  routerAnswer = () => route('general');
  hermes.onRequest((s) => {
    s.delta('ok');
    s.finish();
    s.done();
  });
});

const problem = (res: { json(): unknown }) => ProblemSchema.parse(res.json());
const db = () => env.database.handle.db;
const MISSING = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';

const conversation = async (body: object = { surface: 'android' }) =>
  ConversationSchema.parse((await env.post('/conversations', body, token)).json());
const send = async (conversationId: string, text: string, role?: string) => {
  const res = await env.post(
    `/conversations/${conversationId}/messages`,
    { parts: [{ type: 'text', text }], ...(role ? { role } : {}) },
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
const routeDecided = async (runId: string) =>
  (await events(runId)).find((e) => e.type === 'route.decided');
const systemOf = (index = 0) => hermes.requests[index]!.body.messages[0]!.content;
const decisionsOf = (messageId: string) =>
  db().select().from(routingDecisions).where(eq(routingDecisions.messageId, messageId));

describe('chat memakai role yang dipilih router', () => {
  it('route.decided di awal run, keputusan tersimpan, dan Hermes menerima bundel role itu', async () => {
    routerAnswer = () => route('writer', 0.92);
    const conv = await conversation();
    const { message, run } = await send(conv.id, 'Tulis caption Instagram untuk foto kopi pagi');
    const done = await settle(run.id);

    expect(done).toMatchObject({ status: 'completed', agentRole: 'writer', engine: 'hermes' });
    const all = await events(run.id);
    for (const e of all) expect(AgentEventSchema.safeParse(e).success).toBe(true);
    expect(all.slice(0, 3).map((e) => e.type)).toEqual([
      'run.status',
      'run.status',
      'route.decided',
    ]);
    expect(all[2]).toEqual({
      type: 'route.decided',
      role: 'writer',
      confidence: 0.92,
      reason: 'memilih writer',
    });

    const [row] = await decisionsOf(message.id);
    expect(row).toMatchObject({ role: 'writer', confidence: 0.92, reason: 'memilih writer' });
    expect(row!.latencyMs).toBeGreaterThanOrEqual(0);

    expect(systemOf()).toBe(serverPrompt('writer'));
    expect(systemOf()).toContain('# Peran: Penulis');
    const history = (await env.get(`/conversations/${conv.id}/messages`, token)).json<{
      items: { author: string; agentRole: string | null }[];
    }>();
    expect(history.items.map((m) => [m.author, m.agentRole])).toEqual([
      ['user', null],
      ['assistant', 'writer'],
    ]);
  });

  it('memanggil router-fast dengan suhu 0 dan hanya role yang boleh di konteks Android tanpa project', async () => {
    const conv = await conversation({ surface: 'android' });
    await settle((await send(conv.id, 'Jelaskan apa itu inflasi')).run.id);
    const [call] = routerCalls;
    expect(call).toMatchObject({ model: 'router-fast', temperature: 0 });
    expect(call!.system).toContain('- id: general');
    expect(call!.system).toContain('- id: writer');
    expect(call!.system).not.toContain('- id: frontend');
    expect(call!.system).toContain('surface=android, project=(tidak ada)');
    expect(call!.user).toContain('Jelaskan apa itu inflasi');
  });

  it('pesan lanjutan memakai role giliran sebelumnya tanpa memanggil router; riwayat masuk prompt berikutnya', async () => {
    routerAnswer = () => route('writer');
    const conv = await conversation();
    await settle((await send(conv.id, 'Tulis caption Instagram untuk foto kopi pagi')).run.id);
    expect(routerCalls).toHaveLength(1);

    const next = await send(conv.id, 'lanjut');
    const done = await settle(next.run.id);
    expect(routerCalls).toHaveLength(1);
    expect(done.agentRole).toBe('writer');
    expect(await routeDecided(next.run.id)).toMatchObject({ role: 'writer', confidence: 0.9 });
    expect((await decisionsOf(next.message.id))[0]!.reason).toContain('lanjutan');
    expect(systemOf(1)).toBe(serverPrompt('writer'));

    // Pesan biasa berikutnya: model dipanggil lagi dan melihat riwayat singkat.
    routerAnswer = () => route('researcher');
    await settle((await send(conv.id, 'Cari data pengguna Instagram di Indonesia')).run.id);
    expect(routerCalls).toHaveLength(2);
    expect(routerCalls[1]!.user).toContain(
      'pengguna: Tulis caption Instagram untuk foto kopi pagi',
    );
    expect(routerCalls[1]!.system).toContain('role_sebelumnya=writer');
  });

  it('pilihan manual: tanpa router, confidence 1; role tak sah ditolak 400 sebelum run dibuat', async () => {
    const conv = await conversation();
    const { message, run } = await send(conv.id, 'Ringkas ini', 'researcher');
    const done = await settle(run.id);
    expect(routerCalls).toHaveLength(0);
    expect(done.agentRole).toBe('researcher');
    expect(await routeDecided(run.id)).toMatchObject({ role: 'researcher', confidence: 1 });
    expect((await decisionsOf(message.id))[0]!.reason).toContain('manual');
    expect(systemOf()).toBe(serverPrompt('researcher'));

    const before = (await db().select({ n: count() }).from(runs))[0]!.n;
    const coding = await env.post(
      `/conversations/${conv.id}/messages`,
      { parts: [{ type: 'text', text: 'x' }], role: 'frontend' },
      token,
    );
    expect([coding.statusCode, problem(coding).code]).toEqual([400, 'role_not_allowed']);
    expect((await db().select({ n: count() }).from(runs))[0]!.n).toBe(before);
  });

  it('confidence di bawah 0,6: general dengan alasan; di ambang dipertahankan', async () => {
    routerAnswer = () => route('researcher', 0.45);
    const low = await send((await conversation()).id, 'Hmm soal itu bagaimana ya');
    expect((await settle(low.run.id)).agentRole).toBe('general');
    expect((await routeDecided(low.run.id)) as { reason: string }).toMatchObject({
      role: 'general',
      confidence: 0.45,
    });
    expect((await decisionsOf(low.message.id))[0]!.reason).toContain(
      'Confidence rendah (0.45) untuk researcher',
    );

    routerAnswer = () => route('researcher', 0.6);
    const edge = await send((await conversation()).id, 'Cari data populasi Jawa');
    expect((await settle(edge.run.id)).agentRole).toBe('researcher');
  });

  it('JSON tidak valid dicoba ulang satu kali; dua kali gagal jatuh ke general; router mati juga general', async () => {
    routerAnswer = (_c, n) => (n === 1 ? { content: 'maaf tidak bisa' } : route('writer'));
    const retried = await send((await conversation()).id, 'Tulis surat pendek untuk teman');
    expect((await settle(retried.run.id)).agentRole).toBe('writer');
    expect(routerCalls).toHaveLength(2);
    expect(routerCalls[1]!.user).toContain('tidak valid');

    routerCalls.length = 0;
    routerAnswer = () => ({ content: 'bukan json' });
    const bad = await send((await conversation()).id, 'Tulis surat pendek untuk teman');
    const badDone = await settle(bad.run.id);
    expect(routerCalls).toHaveLength(2);
    expect(badDone).toMatchObject({ status: 'completed', agentRole: 'general' });
    expect((await decisionsOf(bad.message.id))[0]).toMatchObject({
      role: 'general',
      confidence: 0,
    });

    routerCalls.length = 0;
    routerAnswer = () => ({ status: 503 });
    const down = await send((await conversation()).id, 'Tulis surat pendek untuk teman');
    expect(await settle(down.run.id)).toMatchObject({ status: 'completed', agentRole: 'general' });
  });

  it('role coding yang dipilih model tanpa project dipaksa general (Android)', async () => {
    routerAnswer = () => route('frontend', 0.97);
    const { message, run } = await send(
      (await conversation()).id,
      'Perbaiki tombol login di aplikasiku',
    );
    expect((await settle(run.id)).agentRole).toBe('general');
    expect((await decisionsOf(message.id))[0]!.reason).toContain('tidak tersedia di konteks ini');
    expect(systemOf()).toBe(serverPrompt('general'));
  });

  it('needs_split: sub-tugas tertulis di alasan keputusan dan event, run memakai role utama', async () => {
    routerAnswer = () =>
      route('researcher', 0.9, {
        needs_split: true,
        subtasks: [
          { role: 'researcher', title: 'Bandingkan pustaka grafik' },
          { role: 'frontend', title: 'Buat komponen grafik' },
        ],
      });
    const conv = await conversation({ surface: 'android', projectId });
    const { message, run } = await send(conv.id, 'Riset pustaka grafik lalu buatkan komponennya');
    const done = await settle(run.id);
    expect(done.agentRole).toBe('researcher');
    const decided = (await routeDecided(run.id)) as { reason: string };
    expect(decided.reason).toContain('Perlu dipecah menjadi 2 sub-tugas');
    expect(decided.reason).toContain('frontend: Buat komponen grafik');
    expect((await decisionsOf(message.id))[0]!.reason).toBe(decided.reason);
  });
});

describe('project aktif dan mesin yang belum tersedia', () => {
  it('chat per folder di Windows: hanya role coding di prompt; role omp gagal jelas karena worker tidak tersambung', async () => {
    routerAnswer = () => route('frontend', 0.93);
    const conv = await conversation({ surface: 'windows', projectId });
    const { run } = await send(conv.id, 'Tombol simpan kepotong di layar kecil');
    const done = await settle(run.id);

    const [call] = routerCalls;
    expect(call!.system).toContain('project=toko-online, stack=typescript, react, fastify');
    expect(call!.system).toContain('- id: backend');
    expect(call!.system).not.toContain('- id: general');

    expect(done).toMatchObject({
      status: 'failed',
      agentRole: 'frontend',
      engine: 'omp',
      error: { code: 'worker_offline', retryable: true },
    });
    expect(hermes.requests).toHaveLength(0);
    const all = await events(run.id);
    expect(all.map((e) => (e.type === 'run.status' ? e.status : e.type))).toEqual([
      'queued',
      'routing',
      'route.decided',
      'preparing',
      'running',
      'error',
      'failed',
    ]);
    const history = (await env.get(`/conversations/${conv.id}/messages`, token)).json<{
      items: { agentRole: string | null }[];
    }>();
    expect(history.items[1]!.agentRole).toBe('frontend');
  });

  it('chat project di Windows tidak memakai role Umum: pilihan Umum dari model jatuh ke role coding', async () => {
    routerAnswer = () => route('writer');
    const conv = await conversation({ surface: 'windows', projectId });
    const done = await settle((await send(conv.id, 'Tulis catatan rilis singkat')).run.id);
    expect(done).toMatchObject({ agentRole: 'backend', engine: 'omp', status: 'failed' });
    expect(hermes.requests).toHaveLength(0);
  });
});

describe('batal saat routing', () => {
  it('cancel ketika router masih berjalan: run cancelled tanpa route.decided atau error, panggilan model dihentikan', async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    routerAnswer = async () => {
      await held;
      return route('writer');
    };
    const conv = await conversation();
    const { run } = await send(conv.id, 'Tulis caption untuk produk baru');
    await until(
      () => Promise.resolve(routerCalls.length),
      (n) => n === 1,
    );

    const res = await env.post(`/runs/${run.id}/cancel`, {}, token);
    expect(res.statusCode, res.body).toBe(200);
    expect(RunSchema.parse(res.json()).status).toBe('cancelled');
    const all = await events(run.id);
    expect(all.map((e) => e.type)).not.toContain('route.decided');
    expect(all.map((e) => e.type)).not.toContain('error');
    expect(all.at(-1)).toEqual({ type: 'run.status', status: 'cancelled' });
    expect(hermes.requests).toHaveLength(0);
    release();

    // Percakapan bisa dipakai lagi.
    routerAnswer = () => route('general');
    expect((await settle((await send(conv.id, 'Halo lagi')).run.id)).status).toBe('completed');
  });
});

describe('POST /messages/:id/reroute', () => {
  const reroute = (messageId: string, role: string, auth: string | null = token) =>
    env.post(`/messages/${messageId}/reroute`, { role }, auth ?? undefined);

  it('menyimpan koreksi, menjalankan ulang dengan role baru, dan 20 koreksi terbaru masuk prompt router', async () => {
    routerAnswer = () => route('general', 0.8);
    const conv = await conversation();
    const first = await send(conv.id, 'Buatkan script TikTok 30 detik tentang hemat uang');
    await settle(first.run.id);
    const assistantId = (
      await db().select().from(messages).where(eq(messages.runId, first.run.id))
    ).find((m) => m.author === 'assistant')!.id;
    hermes.requests.length = 0;

    const res = await reroute(assistantId, 'writer');
    expect(res.statusCode, res.body).toBe(201);
    const { run, correction } = RerouteResponseSchema.parse(res.json());
    const done = await settle(run.id);

    const [original] = await decisionsOf(first.message.id).then((rows) =>
      rows.sort((a, b) => a.id.localeCompare(b.id)),
    );
    expect(correction).toMatchObject({
      decisionId: original!.id,
      fromRole: 'general',
      toRole: 'writer',
      messageExcerpt: 'Buatkan script TikTok 30 detik tentang hemat uang',
    });
    expect(done).toMatchObject({ status: 'completed', agentRole: 'writer' });
    expect(await routeDecided(run.id)).toMatchObject({ role: 'writer', confidence: 1 });

    // Hermes menerima prompt yang sama dengan bundel role baru, di sesi yang sama.
    expect(hermes.requests).toHaveLength(1);
    expect(hermes.requests[0]!.body.messages).toEqual([
      { role: 'system', content: serverPrompt('writer') },
      { role: 'user', content: 'Buatkan script TikTok 30 detik tentang hemat uang' },
    ]);
    expect(hermes.requests[0]!.headers['x-hermes-session-id']).toBe(`aios-${conv.id}`);

    const decisions = await decisionsOf(first.message.id);
    expect(decisions.map((d) => d.role).sort()).toEqual(['general', 'writer']);
    const history = (await env.get(`/conversations/${conv.id}/messages`, token)).json<{
      items: { author: string; agentRole: string | null; runId: string }[];
    }>();
    expect(history.items.map((m) => [m.author, m.agentRole])).toEqual([
      ['user', null],
      ['assistant', 'general'],
      ['assistant', 'writer'],
    ]);

    // Koreksi ini langsung menjadi contoh di prompt router berikutnya.
    routerCalls.length = 0;
    await settle((await send(conv.id, 'Jelaskan apa itu inflasi')).run.id);
    expect(routerCalls[0]!.system).toContain(
      '"Buatkan script TikTok 30 detik tentang hemat uang" seharusnya writer, bukan general',
    );
  });

  it('hanya 20 koreksi terbaru yang masuk prompt', async () => {
    const conv = await conversation();
    const base = await send(conv.id, 'pesan dasar');
    await settle(base.run.id);
    const [decision] = await decisionsOf(base.message.id);
    for (let i = 1; i <= 22; i++) {
      await db()
        .insert(routingCorrections)
        .values({
          decisionId: decision!.id,
          fromRole: 'general',
          toRole: 'researcher',
          messageExcerpt: `koreksi-${String(i).padStart(2, '0')}`,
        });
    }
    routerCalls.length = 0;
    await settle((await send(conv.id, 'pertanyaan baru yang bukan lanjutan')).run.id);
    const system = routerCalls[0]!.system;
    expect(system).toContain('koreksi-22');
    expect(system).toContain('koreksi-03');
    expect(system).not.toContain('koreksi-02');
    expect(system).not.toContain('koreksi-01');
  });

  it('reroute lewat pesan user juga bisa, dan role yang sama dengan keputusan terakhir ditolak', async () => {
    routerAnswer = () => route('general');
    const conv = await conversation();
    const first = await send(conv.id, 'Rangkum artikel ini untukku');
    await settle(first.run.id);

    const same = await reroute(first.message.id, 'general');
    expect([same.statusCode, problem(same).code]).toEqual([400, 'same_role']);

    const ok = await reroute(first.message.id, 'researcher');
    expect(ok.statusCode, ok.body).toBe(201);
    await settle(RerouteResponseSchema.parse(ok.json()).run.id);

    // Reroute berikutnya dibandingkan dengan keputusan terbaru (researcher), jadi general sekarang sah.
    const again = await reroute(first.message.id, 'general');
    expect(again.statusCode, again.body).toBe(201);
    await settle(RerouteResponseSchema.parse(again.json()).run.id);
    expect(
      (await db().select().from(routingCorrections)).filter((c) => c.toRole === 'general').length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('galat: role tak dikenal, role coding tanpa project, bukan pesan terakhir, tidak ada, tanpa hak', async () => {
    const correctionsBefore = (await db().select({ n: count() }).from(routingCorrections))[0]!.n;
    const conv = await conversation();
    const first = await send(conv.id, 'pesan pertama saja');
    await settle(first.run.id);

    expect(problem(await reroute(first.message.id, 'tukang-sulap')).code).toBe('unknown_role');
    expect(problem(await reroute(first.message.id, 'backend')).code).toBe('role_not_allowed');
    expect((await reroute(MISSING, 'writer')).statusCode).toBe(404);
    expect((await env.post(`/messages/${first.message.id}/reroute`, {}, token)).statusCode).toBe(
      400,
    );
    expect((await reroute(first.message.id, 'writer', null)).statusCode).toBe(401);
    const worker = (await env.loginOk({ kind: 'worker' })).accessToken;
    expect((await reroute(first.message.id, 'writer', worker)).statusCode).toBe(403);

    const second = await send(conv.id, 'pesan kedua yang baru');
    await settle(second.run.id);
    const old = await reroute(first.message.id, 'writer');
    expect([old.statusCode, problem(old).code]).toEqual([409, 'not_latest_message']);

    await env.del(`/conversations/${conv.id}`, token);
    expect(problem(await reroute(second.message.id, 'writer')).code).toBe('conversation_archived');
    // Reroute yang ditolak tidak boleh meninggalkan koreksi.
    expect((await db().select({ n: count() }).from(routingCorrections))[0]!.n).toBe(
      correctionsBefore,
    );
  });

  it('jawaban role lama yang masih berjalan dihentikan dulu, lalu dijalankan ulang', async () => {
    let first = true;
    hermes.onRequest((s) => {
      if (first) {
        first = false;
        s.delta('menggantung');
        return;
      }
      s.delta('versi writer');
      s.finish();
      s.done();
    });
    routerAnswer = () => route('general');
    const conv = await conversation();
    const original = await send(conv.id, 'Buatkan caption singkat untuk kopi');
    await until(
      () => Promise.resolve(hermes.requests.length),
      (n) => n === 1,
    );
    const res = await reroute(original.message.id, 'writer');
    expect(res.statusCode, res.body).toBe(201);
    const { run } = RerouteResponseSchema.parse(res.json());

    expect((await settle(original.run.id)).status).toBe('cancelled');
    expect(await settle(run.id)).toMatchObject({ status: 'completed', agentRole: 'writer' });
  });
});

describe('POST /route/preview', () => {
  const preview = (body: object, auth: string | null = token) =>
    env.post('/route/preview', body, auth ?? undefined);

  it('mengembalikan keputusan sesuai kontrak tanpa menyimpan atau menjalankan apa pun', async () => {
    routerAnswer = () => route('researcher', 0.87);
    const counts = async () => ({
      runs: (await db().select({ n: count() }).from(runs))[0]!.n,
      messages: (await db().select({ n: count() }).from(messages))[0]!.n,
      decisions: (await db().select({ n: count() }).from(routingDecisions))[0]!.n,
    });
    const before = await counts();

    const res = await preview({
      message: 'Cari data inflasi terbaru dengan sumber',
      surface: 'android',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(RouteDecisionSchema.parse(res.json())).toEqual({
      role: 'researcher',
      confidence: 0.87,
      reason: 'memilih researcher',
      needsSplit: false,
      subtasks: [],
    });
    expect(await counts()).toEqual(before);
    expect(hermes.requests).toHaveLength(0);
  });

  it('mengikuti aturan cepat dan konteks: lanjutan, Android tanpa project, project aktif', async () => {
    const cont = await preview({
      message: 'oke lanjut',
      surface: 'android',
      previousRole: 'writer',
    });
    expect(RouteDecisionSchema.parse(cont.json()).role).toBe('writer');
    expect(routerCalls).toHaveLength(0);

    routerAnswer = () => route('frontend', 0.95);
    const android = await preview({ message: 'Perbaiki tombol login', surface: 'android' });
    expect(RouteDecisionSchema.parse(android.json()).role).toBe('general');

    const withProject = await preview({
      message: 'Perbaiki tombol login',
      surface: 'windows',
      projectId,
    });
    expect(RouteDecisionSchema.parse(withProject.json()).role).toBe('frontend');
    expect(routerCalls.at(-1)!.system).toContain('project=toko-online');
  });

  it('galat: project tak ada 404, body salah 400, tanpa token 401, tanpa scope app 403', async () => {
    expect(
      (await preview({ message: 'x', surface: 'android', projectId: MISSING })).statusCode,
    ).toBe(404);
    expect((await preview({ surface: 'android' })).statusCode).toBe(400);
    expect((await preview({ message: 'x', surface: 'tv' })).statusCode).toBe(400);
    expect((await preview({ message: 'x', surface: 'android' }, null)).statusCode).toBe(401);
    const worker = (await env.loginOk({ kind: 'worker' })).accessToken;
    expect((await preview({ message: 'x', surface: 'android' }, worker)).statusCode).toBe(403);
  });

  it('router mati: tetap 200 dengan general', async () => {
    routerAnswer = () => ({ status: 500 });
    const res = await preview({ message: 'Tolong bantu aku', surface: 'android' });
    expect(res.statusCode).toBe(200);
    expect(RouteDecisionSchema.parse(res.json())).toMatchObject({ role: 'general', confidence: 0 });
  });
});
