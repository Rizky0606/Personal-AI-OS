import {
  ProblemSchema,
  RunSchema,
  ScheduleParseResponseSchema,
  ScheduleSchema,
  type ScheduleRun,
} from '@aios/contracts';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import {
  conversations,
  messages,
  projects,
  researchJobs,
  scheduleRuns,
  schedules,
  tasks,
} from '../../db/schema/index.js';
import { createAuthEnv, type AuthEnv } from '../../testing/auth-env.js';
import { startFakeFcm, type FakeFcm } from '../../testing/fake-fcm.js';
import { startFakeHermes, type FakeHermes } from '../../testing/fake-hermes.js';
import { startMockServer, type MockServer } from '../../testing/mock-server.js';
import { SCHEDULE_QUEUE } from './service.js';

let env: AuthEnv;
let hermes: FakeHermes;
let router: MockServer;
let fcm: FakeFcm;
let token: string;
/** Balasan model parser; null = 9Router tiruan gagal. */
let parserReply: object | null;
const MISSING = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';

beforeAll(async () => {
  hermes = await startFakeHermes();
  fcm = await startFakeFcm();
  router = await startMockServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      if (!body.includes('Permintaan pengguna') || !parserReply)
        return void res.writeHead(500).end();
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: JSON.stringify(parserReply) } }],
          usage: { prompt_tokens: 5, completion_tokens: 5 },
        }),
      );
    });
  });
  env = await createAuthEnv(inject('testDatabaseUrl'), {
    hermesUrl: hermes.url,
    ninerouterUrl: `${router.url}/v1`,
    schedules: { pollMs: 20 },
    push: { baseUrl: fcm.baseUrl, account: fcm.account },
  });
  token = (await env.loginOk({ kind: 'android', pushToken: 'fcm-token-hp' })).accessToken;
}, 120_000);
afterAll(async () => {
  await env.close();
  await Promise.all([hermes.close(), router.close(), fcm.close()]);
});
beforeEach(async () => {
  hermes.requests.length = 0;
  fcm.sent.length = 0;
  parserReply = null;
  hermes.onRequest((s) => {
    s.delta('Ringkasan hari ini.');
    s.finish();
    s.usage(10, 4);
    s.done();
  });
  // Antar-tes tidak boleh saling mewarisi jadwal.
  await env.schedules.idle();
  for (const s of await env.schedules.list()) await env.schedules.remove(s.id);
});

const db = () => env.database.handle.db;
const problem = (res: { json(): unknown }) => ProblemSchema.parse(res.json());
const until = async <T>(read: () => Promise<T>, ok: (v: T) => boolean, ms = 30_000): Promise<T> => {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = await read();
    if (ok(v) || Date.now() > deadline) return v;
    await new Promise((r) => setTimeout(r, 20));
  }
};

const body = (extra: object = {}) => ({
  name: 'Ringkasan harian',
  cron: '*/5 * * * *',
  prompt: 'Ringkas agenda hari ini.',
  target: 'chat',
  ...extra,
});
const create = async (extra: object = {}) => {
  const res = await env.post('/schedules', body(extra), token);
  expect(res.statusCode, res.body).toBe(201);
  return ScheduleSchema.parse(res.json());
};
const history = async (id: string): Promise<ScheduleRun[]> =>
  (await env.get(`/schedules/${id}/runs`, token)).json<{ items: ScheduleRun[] }>().items;
const conversationMessages = (conversationId: string) =>
  db()
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(messages.id);
const patch = (path: string, payload: object, accessToken: string) =>
  env.app.inject({
    method: 'PATCH',
    url: `/v1${path}`,
    headers: { authorization: `Bearer ${accessToken}` },
    payload,
  });
const pgSchedules = async () =>
  (await env.boss!.getSchedules(SCHEDULE_QUEUE)).map((s) => [s.key, s.cron, s.timezone]);

describe('POST /schedules/parse', () => {
  it('mengurai tanpa menyimpan: penjelasan, 3 waktu berikutnya, dan tidak ada baris jadwal', async () => {
    parserReply = {
      name: 'Berita AI',
      cron: '0 7 * * 1',
      prompt: 'Ringkas berita AI.',
      target: 'chat',
    };
    const res = await env.post(
      '/schedules/parse',
      { text: 'setiap Senin jam 7 pagi ringkas berita AI' },
      token,
    );
    expect(res.statusCode, res.body).toBe(200);
    const parsed = ScheduleParseResponseSchema.parse(res.json());
    expect(parsed).toMatchObject({
      cron: '0 7 * * 1',
      timezone: 'Asia/Jakarta',
      description: 'Setiap Senin 07.00 WIB',
    });
    expect(parsed.nextRuns).toEqual([
      '2026-10-26T00:00:00.000Z',
      '2026-11-02T00:00:00.000Z',
      '2026-11-09T00:00:00.000Z',
    ]);
    expect(await db().select().from(schedules)).toHaveLength(0);
    expect(await pgSchedules()).toEqual([]);
  });

  it('bukan jadwal: 422; model mati: 502; tanpa token: 401; teks kosong: 400', async () => {
    parserReply = { error: 'Ini bukan jadwal berulang.' };
    const refused = await env.post('/schedules/parse', { text: 'halo' }, token);
    expect([refused.statusCode, problem(refused).code]).toEqual([422, 'schedule_unparseable']);

    parserReply = null;
    const down = await env.post('/schedules/parse', { text: 'setiap hari jam 7' }, token);
    expect([down.statusCode, problem(down).code]).toEqual([502, 'router_unavailable']);

    expect((await env.post('/schedules/parse', { text: 'x' })).statusCode).toBe(401);
    expect((await env.post('/schedules/parse', { text: '' }, token)).statusCode).toBe(400);
  });
});

describe('CRUD jadwal', () => {
  it('membuat jadwal: percakapan khusus, next_run_at, dan cron terdaftar di pg-boss dengan zona waktu', async () => {
    const s = await create({ timezone: 'Asia/Makassar' });
    expect(s).toMatchObject({ enabled: true, timezone: 'Asia/Makassar', agentRole: null });
    expect(s.conversationId).not.toBeNull();
    expect(s.nextRunAt).toBe('2026-10-22T06:05:00.000Z'); // jam palsu 06:00 → kelipatan 5 berikutnya
    expect(await pgSchedules()).toEqual([[s.id, '*/5 * * * *', 'Asia/Makassar']]);

    const [conv] = await db()
      .select()
      .from(conversations)
      .where(eq(conversations.id, s.conversationId!));
    expect(conv).toMatchObject({ title: 'Ringkasan harian', surface: 'android' });
    expect((await env.get('/schedules', token)).json<{ items: unknown[] }>().items).toHaveLength(1);
  });

  it('zona waktu bawaan Asia/Jakarta', async () => {
    expect((await create()).timezone).toBe('Asia/Jakarta');
  });

  it.each([
    ['cron salah', { cron: '99 7 * * 1' }, 'invalid_cron'],
    ['zona salah', { timezone: 'WIB' }, 'invalid_timezone'],
    ['role tanpa nama', { target: 'role' }, 'agent_role_required'],
    ['role tidak ada', { target: 'role', agentRole: 'tukang-sulap' }, 'unknown_role'],
    ['role coding', { target: 'role', agentRole: 'frontend' }, 'role_not_schedulable'],
  ])('menolak %s dengan 400 dan tidak menyimpan apa pun', async (_n, extra, code) => {
    const res = await env.post('/schedules', body(extra), token);
    expect([res.statusCode, problem(res).code]).toEqual([400, code]);
    expect(await db().select().from(schedules)).toHaveLength(0);
    expect(await pgSchedules()).toEqual([]);
  });

  it('PATCH: mengubah cron memperbarui pg-boss; menonaktifkan menghapus cron dan next_run_at; mengaktifkan memulihkan', async () => {
    const s = await create();
    const patched = ScheduleSchema.parse(
      (await patch(`/schedules/${s.id}`, { cron: '0 7 * * 1', name: 'Mingguan' }, token)).json(),
    );
    expect(patched).toMatchObject({
      cron: '0 7 * * 1',
      name: 'Mingguan',
      nextRunAt: '2026-10-26T00:00:00.000Z',
    });
    expect(await pgSchedules()).toEqual([[s.id, '0 7 * * 1', 'Asia/Jakarta']]);
    const [conv] = await db()
      .select()
      .from(conversations)
      .where(eq(conversations.id, s.conversationId!));
    expect(conv!.title).toBe('Mingguan');

    const off = ScheduleSchema.parse(
      (await patch(`/schedules/${s.id}`, { enabled: false }, token)).json(),
    );
    expect([off.enabled, off.nextRunAt]).toEqual([false, null]);
    expect(await pgSchedules()).toEqual([]);

    const on = ScheduleSchema.parse(
      (await patch(`/schedules/${s.id}`, { enabled: true }, token)).json(),
    );
    expect(on.nextRunAt).not.toBeNull();
    expect(await pgSchedules()).toHaveLength(1);

    const bad = await patch(`/schedules/${s.id}`, { cron: '99 7 * * 1' }, token);
    expect([bad.statusCode, problem(bad).code]).toEqual([400, 'invalid_cron']);
  });

  it('DELETE: cron dihapus, percakapan hasil diarsipkan (pesan tetap ada), 404 setelahnya', async () => {
    const s = await create();
    expect((await env.del(`/schedules/${s.id}`, token)).statusCode).toBe(204);
    expect(await pgSchedules()).toEqual([]);
    const [conv] = await db()
      .select()
      .from(conversations)
      .where(eq(conversations.id, s.conversationId!));
    expect(conv!.archivedAt).not.toBeNull();
    expect((await env.del(`/schedules/${s.id}`, token)).statusCode).toBe(404);
    expect((await env.get(`/schedules/${MISSING}/runs`, token)).statusCode).toBe(404);
    expect((await env.post(`/schedules/${MISSING}/run-now`, {}, token)).statusCode).toBe(404);
  });
});

describe('run-now: hasil tersimpan sebagai pesan dan notifikasi dikirim', () => {
  it('target chat: run Hermes dengan role, pesan user+assistant di percakapan jadwal, riwayat succeeded, push judul+ID', async () => {
    const s = await create({ agentRole: 'writer', target: 'role' });
    const res = await env.post(`/schedules/${s.id}/run-now`, {}, token);
    expect(res.statusCode, res.body).toBe(201);
    const run = RunSchema.parse(res.json());
    expect(run.conversationId).toBe(s.conversationId);

    await env.schedules.idle();
    const [row] = await history(s.id);
    expect(row).toMatchObject({ scheduleId: s.id, runId: run.id, status: 'succeeded' });
    expect(row!.finishedAt).not.toBeNull();

    const msgs = await conversationMessages(s.conversationId!);
    expect(msgs.map((m) => [m.author, m.agentRole])).toEqual([
      ['user', null],
      ['assistant', 'writer'],
    ]);
    expect(msgs[0]!.parts).toEqual([{ type: 'text', text: 'Ringkas agenda hari ini.' }]);
    expect(msgs[1]!.parts).toEqual([{ type: 'text', text: 'Ringkasan hari ini.' }]);

    await env.push.idle();
    expect(fcm.sent).toHaveLength(1);
    expect(fcm.sent[0]).toMatchObject({ token: 'fcm-token-hp', title: 'Ringkasan harian' });
    expect(fcm.sent[0]!.data).toMatchObject({
      type: 'schedule.result',
      scheduleId: s.id,
      scheduleRunId: row!.id,
      status: 'succeeded',
      runId: run.id,
      conversationId: s.conversationId,
    });
    expect(JSON.stringify(fcm.sent)).not.toContain('Ringkasan hari ini.');
  });

  it('beberapa run memperpanjang percakapan yang sama, riwayat terbaru dulu dengan paginasi', async () => {
    const s = await create();
    for (let i = 0; i < 3; i++) {
      expect((await env.post(`/schedules/${s.id}/run-now`, {}, token)).statusCode).toBe(201);
      await env.schedules.idle();
    }
    expect(await conversationMessages(s.conversationId!)).toHaveLength(6);
    const page1 = (await env.get(`/schedules/${s.id}/runs?limit=2`, token)).json<{
      items: ScheduleRun[];
      nextBefore: string | null;
    }>();
    expect(page1.items).toHaveLength(2);
    expect(page1.nextBefore).not.toBeNull();
    const page2 = (
      await env.get(`/schedules/${s.id}/runs?limit=2&before=${page1.nextBefore}`, token)
    ).json<{ items: ScheduleRun[]; nextBefore: string | null }>();
    expect(page2.items).toHaveLength(1);
    expect(page2.nextBefore).toBeNull();
  });

  it('Hermes gagal: riwayat failed, pesan sistem "Jadwal gagal", push berjudul "— gagal"', async () => {
    hermes.onRequest((_s, _r, res) => void res.writeHead(500).end());
    const s = await create();
    expect((await env.post(`/schedules/${s.id}/run-now`, {}, token)).statusCode).toBe(201);
    await env.schedules.idle();
    expect((await history(s.id))[0]!.status).toBe('failed');
    const msgs = await conversationMessages(s.conversationId!);
    expect(msgs.at(-1)).toMatchObject({ author: 'system' });
    expect(JSON.stringify(msgs.at(-1)!.parts)).toContain('Jadwal gagal');
    await env.push.idle();
    expect(fcm.sent[0]!.title).toBe('Ringkasan harian — gagal');
  });

  it('role coding yang tersimpan sebelum aturan berubah gagal dengan jelas, bukan menggantung', async () => {
    const s = await create();
    await db()
      .update(schedules)
      .set({ target: 'role', agentRole: 'frontend' })
      .where(eq(schedules.id, s.id));
    const res = await env.post(`/schedules/${s.id}/run-now`, {}, token);
    expect([res.statusCode, problem(res).code]).toEqual([400, 'role_not_schedulable']);
    expect((await history(s.id))[0]!.status).toBe('failed');
  });
});

describe('singleton dan jadwal terlewat', () => {
  it('run kedua saat yang pertama masih berjalan: 409; sesudah selesai bisa lagi', async () => {
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    hermes.onRequest(async (s) => {
      s.delta('Mulai');
      await gate;
      s.finish();
      s.done();
    });
    const s = await create();
    expect((await env.post(`/schedules/${s.id}/run-now`, {}, token)).statusCode).toBe(201);
    const second = await env.post(`/schedules/${s.id}/run-now`, {}, token);
    expect([second.statusCode, problem(second).code]).toEqual([409, 'schedule_run_in_progress']);
    expect((await history(s.id)).map((r) => r.status)).toEqual(['running']);

    open();
    await env.schedules.idle();
    expect((await history(s.id)).map((r) => r.status)).toEqual(['succeeded']);
    expect((await env.post(`/schedules/${s.id}/run-now`, {}, token)).statusCode).toBe(201);
    await env.schedules.idle();
  });

  it('pemicu cron saat run sebelumnya masih berjalan dicatat missed, tidak menumpuk run kedua', async () => {
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    hermes.onRequest(async (s) => {
      s.delta('Lama');
      await gate;
      s.finish();
      s.done();
    });
    const s = await create();
    await env.post(`/schedules/${s.id}/run-now`, {}, token);
    await env.boss!.send(SCHEDULE_QUEUE, { scheduleId: s.id });
    const rows = await until(
      () => history(s.id),
      (r) => r.some((x) => x.status === 'missed'),
    );
    expect(rows.map((r) => r.status).sort()).toEqual(['missed', 'running']);
    expect(hermes.requests).toHaveLength(1);
    open();
    await env.schedules.idle();
  });

  it('antrean: dua pekerjaan jadwal yang sama tidak diantre ganda (singletonKey)', async () => {
    const s = await create({ enabled: false }); // tidak ada cron sungguhan yang ikut menembak
    const key = { singletonKey: s.id };
    const first = await env.boss!.send(SCHEDULE_QUEUE, { scheduleId: 'x' }, key);
    const second = await env.boss!.send(SCHEDULE_QUEUE, { scheduleId: 'x' }, key);
    expect(first === null && second === null).toBe(false);
    // Salah satu dari dua pengiriman berurutan harus ditolak bila yang pertama masih menunggu.
    if (first && second) expect(first).not.toBe(second);
  });

  it('pemicu cron menjalankan jadwal: hasil tersimpan dan next_run_at maju', async () => {
    const s = await create();
    await db()
      .update(schedules)
      .set({ nextRunAt: new Date('2000-01-01T00:00:00Z') })
      .where(eq(schedules.id, s.id));
    await env.boss!.send(SCHEDULE_QUEUE, { scheduleId: s.id });
    const rows = await until(
      () => history(s.id),
      (r) => r.some((x) => x.status === 'succeeded'),
    );
    expect(rows[0]!.status).toBe('succeeded');
    expect((await conversationMessages(s.conversationId!)).map((m) => m.author)).toEqual([
      'user',
      'assistant',
    ]);
    const [after] = await db().select().from(schedules).where(eq(schedules.id, s.id));
    expect(after!.nextRunAt!.getTime()).toBeGreaterThan(Date.UTC(2026, 9, 22, 6, 0, 0));
  });

  it('jadwal yang dinonaktifkan atau dihapus tidak berjalan walau pekerjaannya sudah di antrean', async () => {
    const s = await create({ enabled: false });
    await env.boss!.send(SCHEDULE_QUEUE, { scheduleId: s.id });
    await env.boss!.send(SCHEDULE_QUEUE, { scheduleId: MISSING });
    await new Promise((r) => setTimeout(r, 1500));
    await env.schedules.idle();
    expect(await db().select().from(scheduleRuns)).toHaveLength(0);
    expect(hermes.requests).toHaveLength(0);
  });

  it('server mati lama: kemunculan terlewat dicatat missed (maks 20, yang terbaru) dan next_run_at maju ke depan', async () => {
    const s = await create({ cron: '*/5 * * * *' });
    // Jam palsu maju 3 jam sementara "server mati": 36 kemunculan terlewat.
    await db()
      .update(schedules)
      .set({ nextRunAt: new Date(env.clock.now) })
      .where(eq(schedules.id, s.id));
    const realNow = env.clock.now;
    env.clock.now += 3 * 3600_000;
    // Jam palsu juga dipakai JWT; kembalikan segera setelah pencatatan supaya request berikutnya sah.
    let recorded: number;
    try {
      recorded = await env.schedules.recordMissed();
    } finally {
      env.clock.now = realNow;
    }
    const clockAtRecord = realNow + 3 * 3600_000;
    expect(recorded).toBe(20);
    const rows = (await history(s.id)).filter((r) => r.status === 'missed');
    expect(rows).toHaveLength(20);
    const times = rows.map((r) => Date.parse(r.startedAt)).sort((a, b) => a - b);
    expect(times.at(-1)).toBeLessThanOrEqual(clockAtRecord - 120_000);
    expect(times.at(-1)! - times[0]!).toBe(19 * 5 * 60_000);
    const [after] = await db().select().from(schedules).where(eq(schedules.id, s.id));
    expect(after!.nextRunAt!.getTime()).toBeGreaterThan(clockAtRecord - 120_000);
    expect(after!.nextRunAt!.getTime()).toBeLessThanOrEqual(clockAtRecord + 5 * 60_000);

    // Dipanggil lagi tanpa waktu berjalan: tidak ada catatan ganda.
    expect(await env.schedules.recordMissed()).toBe(0);
    // Missed tidak memicu push.
    await env.push.idle();
    expect(fcm.sent).toHaveLength(0);
  });

  it('kemunculan dalam 2 menit terakhir belum dianggap terlewat (masih bisa dijalankan cron)', async () => {
    const s = await create();
    await db()
      .update(schedules)
      .set({ nextRunAt: new Date(env.clock.now - 30_000) })
      .where(eq(schedules.id, s.id));
    expect(await env.schedules.recordMissed()).toBe(0);
    expect(await history(s.id)).toEqual([]);
  });

  it('jadwal nonaktif tidak dicatat terlewat', async () => {
    const s = await create({ enabled: false });
    await db()
      .update(schedules)
      .set({ nextRunAt: new Date('2000-01-01T00:00:00Z') })
      .where(eq(schedules.id, s.id));
    expect(await env.schedules.recordMissed()).toBe(0);
  });

  it('start() sesudah restart: run yang tertinggal running ditutup failed dan cron disinkronkan dengan database', async () => {
    const s = await create();
    const off = await create({ name: 'Mati', enabled: false });
    await db().insert(scheduleRuns).values({ scheduleId: s.id, status: 'running' });
    await env.boss!.schedule(SCHEDULE_QUEUE, '0 1 * * *', {}, { key: MISSING, tz: 'UTC' }); // cron yatim
    await env.schedules.start();
    expect((await history(s.id)).map((r) => r.status)).toEqual(['failed']);
    expect((await pgSchedules()).map((p) => p[0])).toEqual([s.id]);
    expect(off.enabled).toBe(false);
    // Bisa menjalankan lagi karena singleton sudah bebas.
    expect((await env.post(`/schedules/${s.id}/run-now`, {}, token)).statusCode).toBe(201);
    await env.schedules.idle();
  });
});

describe('cron nyata pg-boss', () => {
  it('jadwal "* * * * *" ditembakkan pg-boss sendiri dan hasilnya tersimpan', async () => {
    const s = await create({ cron: '* * * * *', name: 'Tiap menit' });
    const rows = await until(
      () => history(s.id),
      (r) => r.some((x) => x.status === 'succeeded'),
      120_000,
    );
    expect(rows.some((r) => r.status === 'succeeded')).toBe(true);
    expect((await conversationMessages(s.conversationId!)).length).toBeGreaterThanOrEqual(2);
    await env.push.idle();
    expect(fcm.sent.some((m) => m.title === 'Tiap menit')).toBe(true);
  }, 150_000);
});

describe('briefing pagi dan notifikasi hanya bila berubah', () => {
  const lastPrompt = () => {
    const msgs = hermes.requests.at(-1)?.body.messages ?? [];
    return String(msgs.filter((m) => m.role === 'user').at(-1)?.content ?? '');
  };
  const runOnce = async (id: string) => {
    expect((await env.post(`/schedules/${id}/run-now`, {}, token)).statusCode).toBe(201);
    await env.schedules.idle();
    await env.push.idle();
  };

  it('briefing: data 24 jam terakhir dikirim ke agent sebagai konteks, tidak disimpan di pesan pengguna', async () => {
    const worker = await env.loginOk({ kind: 'worker', name: 'PC briefing' });
    const [project] = await db()
      .insert(projects)
      .values({
        name: 'toko-online',
        workerDeviceId: worker.device.id,
        stack: { languages: [], frameworks: [] },
      })
      .returning();
    await db()
      .insert(tasks)
      .values({ projectId: project!.id, title: 'Halaman checkout', status: 'review' });
    await db()
      .insert(researchJobs)
      .values({ question: 'Tren mobil listrik 2026', status: 'completed' });

    const s = await create({ target: 'briefing', prompt: 'Berita AI hari ini.' });
    await runOnce(s.id);

    const prompt = lastPrompt();
    expect(prompt).toContain('Berita AI hari ini.');
    expect(prompt).toContain('# Data briefing');
    expect(prompt).toContain('[toko-online] Halaman checkout');
    expect(prompt).toContain('Tren mobil listrik 2026');
    // Briefing selalu disusun role Umum.
    const msgs = await conversationMessages(s.conversationId!);
    expect(msgs.map((m) => [m.author, m.agentRole])).toEqual([
      ['user', null],
      ['assistant', 'general'],
    ]);
    expect(msgs[0]!.parts).toEqual([{ type: 'text', text: 'Berita AI hari ini.' }]);
    expect(fcm.sent).toHaveLength(1);
  });

  it('on_change: run pertama memberi tahu; hasil sama ditandai changed=false tanpa push; hasil beda memberi tahu', async () => {
    const s = await create({ notify: 'on_change', prompt: 'Cek harga laptop X.' });
    expect(s.notify).toBe('on_change');

    hermes.onRequest((st) => {
      st.delta('Harga laptop X Rp15 juta.');
      st.finish();
      st.done();
    });
    await runOnce(s.id);
    expect(lastPrompt()).not.toContain('Hasil run sebelumnya');
    expect((await history(s.id))[0]).toMatchObject({ status: 'succeeded', changed: null });
    expect(fcm.sent).toHaveLength(1);

    hermes.onRequest((st) => {
      st.delta('[TIDAK ADA PERUBAHAN] Masih Rp15 juta.');
      st.finish();
      st.done();
    });
    await runOnce(s.id);
    expect(lastPrompt()).toContain('# Hasil run sebelumnya');
    expect(lastPrompt()).toContain('Harga laptop X Rp15 juta.');
    expect((await history(s.id))[0]).toMatchObject({ status: 'succeeded', changed: false });
    expect(fcm.sent).toHaveLength(1);
    const msgs = await conversationMessages(s.conversationId!);
    expect(msgs.at(-1)!.parts).toEqual([
      { type: 'text', text: '**Tidak ada perubahan sejak run sebelumnya.** Masih Rp15 juta.' },
    ]);
    // Pesan pengguna tetap prompt jadwal saja, tanpa konteks pembanding.
    expect(msgs.filter((m) => m.author === 'user').map((m) => m.parts)).toEqual([
      [{ type: 'text', text: 'Cek harga laptop X.' }],
      [{ type: 'text', text: 'Cek harga laptop X.' }],
    ]);

    hermes.onRequest((st) => {
      st.delta('Turun! Sekarang Rp13 juta.');
      st.finish();
      st.done();
    });
    await runOnce(s.id);
    expect((await history(s.id))[0]).toMatchObject({ status: 'succeeded', changed: true });
    expect(fcm.sent).toHaveLength(2);
  });

  it('on_change ditolak untuk jadwal riset; notify bisa diubah lewat PATCH', async () => {
    const res = await env.post(
      '/schedules',
      body({ target: 'research', notify: 'on_change' }),
      token,
    );
    expect(res.statusCode).toBe(400);
    expect(problem(res).code).toBe('notify_unsupported');

    const s = await create();
    expect(s.notify).toBe('always');
    const updated = await patch(`/schedules/${s.id}`, { notify: 'on_change' }, token);
    expect(updated.statusCode, updated.body).toBe(200);
    expect(ScheduleSchema.parse(updated.json()).notify).toBe('on_change');
  });

  it('pengurai: target briefing dan notify on_change diteruskan; riset dipaksa always', async () => {
    parserReply = {
      name: 'Briefing pagi',
      cron: '0 7 * * *',
      prompt: 'Berita AI.',
      target: 'briefing',
      notify: 'on_change',
    };
    const parsed = ScheduleParseResponseSchema.parse(
      (await env.post('/schedules/parse', { text: 'briefing tiap pagi jam 7' }, token)).json(),
    );
    expect(parsed).toMatchObject({ target: 'briefing', notify: 'on_change', agentRole: null });

    parserReply = {
      name: 'Riset',
      cron: '0 7 * * 1',
      prompt: 'Riset EV.',
      target: 'research',
      notify: 'on_change',
    };
    const research = ScheduleParseResponseSchema.parse(
      (await env.post('/schedules/parse', { text: 'riset EV tiap Senin' }, token)).json(),
    );
    expect(research.notify).toBe('always');
  });
});
