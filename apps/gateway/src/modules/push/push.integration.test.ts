import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import {
  auditLog,
  devices,
  researchJobs,
  runs,
  scheduleRuns,
  schedules,
} from '../../db/schema/index.js';
import { createAuthEnv, type AuthEnv } from '../../testing/auth-env.js';
import { startFakeFcm, type FakeFcm } from '../../testing/fake-fcm.js';

let fcm: FakeFcm;
let env: AuthEnv;
let phone: { id: string; token: string };
let tablet: { id: string; token: string };
let desktopId: string;
let revokedId: string;
let noTokenId: string;

const db = () => env.database.handle.db;
const tokenOf = async (id: string) =>
  (await db().select().from(devices).where(eq(devices.id, id)))[0]?.pushToken;

beforeAll(async () => {
  fcm = await startFakeFcm();
  env = await createAuthEnv(inject('testDatabaseUrl'), {
    push: { baseUrl: fcm.baseUrl, account: fcm.account },
  });
  const login = (opts: Parameters<AuthEnv['loginOk']>[0]) => env.loginOk(opts);
  const a = await login({ kind: 'android', name: 'HP', pushToken: 'fcm-token-hp' });
  const b = await login({ kind: 'android', name: 'Tablet', pushToken: 'fcm-token-tablet' });
  desktopId = (await login({ kind: 'desktop', name: 'PC', pushToken: 'fcm-token-pc' })).device.id;
  const gone = await login({ kind: 'android', name: 'HP lama', pushToken: 'fcm-token-lama' });
  noTokenId = (await login({ kind: 'android', name: 'HP tanpa token' })).device.id;
  revokedId = gone.device.id;
  await db().update(devices).set({ revokedAt: new Date() }).where(eq(devices.id, revokedId));
  phone = { id: a.device.id, token: 'fcm-token-hp' };
  tablet = { id: b.device.id, token: 'fcm-token-tablet' };
});
afterAll(async () => {
  await env.close();
  await fcm.close();
});
beforeEach(() => {
  fcm.sent.length = 0;
  fcm.replyFor.clear();
});

const newSchedule = async (name = 'Ringkasan berita AI') => {
  const [conversation] = await db()
    .insert((await import('../../db/schema/index.js')).conversations)
    .values({ title: name, surface: 'android' })
    .returning();
  const [row] = await db()
    .insert(schedules)
    .values({
      name,
      cron: '0 7 * * 1',
      prompt: 'Ringkas berita AI. RAHASIA-ISI-PROMPT',
      target: 'chat',
      conversationId: conversation!.id,
    })
    .returning();
  const [run] = await db()
    .insert(scheduleRuns)
    .values({ scheduleId: row!.id, status: 'succeeded', finishedAt: new Date() })
    .returning();
  return { schedule: row!, scheduleRun: run!, conversationId: conversation!.id };
};

describe('push untuk schedule.result', () => {
  it('terkirim hanya ke perangkat Android aktif ber-token; payload hanya judul dan ID', async () => {
    const { schedule, scheduleRun, conversationId } = await newSchedule();
    env.hub.publishLive('user', {
      type: 'schedule.result',
      scheduleId: schedule.id,
      scheduleRunId: scheduleRun.id,
      runId: null,
      status: 'succeeded',
    });
    await env.push.idle();

    expect(fcm.sent.map((m) => m.token).sort()).toEqual([phone.token, tablet.token].sort());
    for (const m of fcm.sent) {
      expect(m.title).toBe('Ringkasan berita AI');
      expect(m.notification).toEqual({ title: 'Ringkasan berita AI' }); // tanpa body
      expect(m.data).toEqual({
        type: 'schedule.result',
        scheduleId: schedule.id,
        scheduleRunId: scheduleRun.id,
        status: 'succeeded',
        conversationId,
      });
    }
    // Tidak ke desktop, perangkat dicabut, atau yang tanpa token; isi prompt tidak ikut.
    expect(JSON.stringify(fcm.sent)).not.toMatch(/fcm-token-pc|fcm-token-lama|RAHASIA-ISI-PROMPT/);
    expect([desktopId, revokedId, noTokenId]).toHaveLength(3);
  });

  it('jadwal gagal: judul memuat "gagal"; runId ikut sebagai ID', async () => {
    const { schedule, scheduleRun } = await newSchedule('Cek server');
    const [run] = await db().insert(runs).values({ kind: 'chat', engine: 'hermes' }).returning();
    env.hub.publishLive('user', {
      type: 'schedule.result',
      scheduleId: schedule.id,
      scheduleRunId: scheduleRun.id,
      runId: run!.id,
      status: 'failed',
    });
    await env.push.idle();
    expect(fcm.sent[0]!.title).toBe('Cek server — gagal');
    expect(fcm.sent[0]!.data).toMatchObject({ status: 'failed', runId: run!.id });
  });

  it('judul panjang dipotong; status missed dan running tidak memicu push; jadwal yang sudah dihapus diabaikan', async () => {
    const { schedule, scheduleRun } = await newSchedule('N'.repeat(200));
    for (const status of ['missed', 'running'] as const) {
      env.hub.publishLive('user', {
        type: 'schedule.result',
        scheduleId: schedule.id,
        scheduleRunId: scheduleRun.id,
        runId: null,
        status,
      });
    }
    await env.push.idle();
    expect(fcm.sent).toHaveLength(0);

    env.hub.publishLive('user', {
      type: 'schedule.result',
      scheduleId: schedule.id,
      scheduleRunId: scheduleRun.id,
      runId: null,
      status: 'succeeded',
    });
    await env.push.idle();
    expect(fcm.sent[0]!.title!.length).toBeLessThanOrEqual(60);

    fcm.sent.length = 0;
    env.hub.publishLive('user', {
      type: 'schedule.result',
      scheduleId: '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f',
      scheduleRunId: scheduleRun.id,
      runId: null,
      status: 'succeeded',
    });
    await env.push.idle();
    expect(fcm.sent).toHaveLength(0);
  });
});

describe('push untuk research.completed', () => {
  it('judul "Riset selesai: ..." dan ID riset/run saja; isi laporan tidak ikut', async () => {
    const [run] = await db()
      .insert(runs)
      .values({ kind: 'research', engine: 'research' })
      .returning();
    const [job] = await db()
      .insert(researchJobs)
      .values({
        question:
          'Bagaimana perkembangan kendaraan listrik di Asia Tenggara tahun ini secara lengkap?',
        status: 'completed',
        reportMd: '# ISI-LAPORAN-RAHASIA',
        runId: run!.id,
      })
      .returning();
    env.hub.publishLive('user', {
      type: 'research.completed',
      researchId: job!.id,
      runId: run!.id,
    });
    await env.push.idle();

    expect(fcm.sent).toHaveLength(2);
    for (const m of fcm.sent) {
      expect(m.title).toMatch(/^Riset selesai: Bagaimana perkembangan kendaraan listrik/);
      expect(m.title!.length).toBeLessThanOrEqual(75);
      expect(m.notification).toEqual({ title: m.title });
      expect(m.data).toEqual({ type: 'research.completed', researchId: job!.id, runId: run!.id });
    }
    expect(JSON.stringify(fcm.sent)).not.toContain('ISI-LAPORAN-RAHASIA');
  });

  it('riset yang dijalankan sebuah jadwal tidak mendapat push kedua (schedule.result sudah cukup)', async () => {
    const { schedule } = await newSchedule();
    const [run] = await db()
      .insert(runs)
      .values({ kind: 'research', engine: 'research' })
      .returning();
    await db()
      .insert(scheduleRuns)
      .values({ scheduleId: schedule.id, runId: run!.id, status: 'running' });
    const [job] = await db()
      .insert(researchJobs)
      .values({ question: 'riset dari jadwal', status: 'completed', runId: run!.id })
      .returning();
    env.hub.publishLive('user', {
      type: 'research.completed',
      researchId: job!.id,
      runId: run!.id,
    });
    await env.push.idle();
    expect(fcm.sent).toHaveLength(0);
  });
});

describe('token mati dan kegagalan FCM', () => {
  it('UNREGISTERED: token perangkat itu dihapus dan tercatat di audit (tanpa nilai token); perangkat lain tetap menerima', async () => {
    await db()
      .update(devices)
      .set({ pushToken: 'fcm-token-tablet' })
      .where(eq(devices.id, tablet.id));
    fcm.replyFor.set('fcm-token-tablet', {
      status: 404,
      body: { error: { code: 404, status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } },
    });
    const { schedule, scheduleRun } = await newSchedule();
    env.hub.publishLive('user', {
      type: 'schedule.result',
      scheduleId: schedule.id,
      scheduleRunId: scheduleRun.id,
      runId: null,
      status: 'succeeded',
    });
    await env.push.idle();

    expect(fcm.sent.map((m) => m.token).sort()).toEqual(['fcm-token-hp', 'fcm-token-tablet']);
    expect(await tokenOf(tablet.id)).toBeNull();
    expect(await tokenOf(phone.id)).toBe('fcm-token-hp');
    const audit = (await db().select().from(auditLog)).filter(
      (a) => a.action === 'push.token_cleared',
    );
    expect(audit.map((a) => a.target)).toEqual([`device:${tablet.id}`]);
    expect(JSON.stringify(audit)).not.toContain('fcm-token');

    // Berikutnya tablet tidak dicoba lagi.
    fcm.sent.length = 0;
    env.hub.publishLive('user', {
      type: 'schedule.result',
      scheduleId: schedule.id,
      scheduleRunId: scheduleRun.id,
      runId: null,
      status: 'succeeded',
    });
    await env.push.idle();
    expect(fcm.sent.map((m) => m.token)).toEqual(['fcm-token-hp']);
  });

  it('FCM menolak pesan (400): token tidak dihapus', async () => {
    fcm.replyFor.set('fcm-token-hp', {
      status: 400,
      body: { error: { status: 'INVALID_ARGUMENT' } },
    });
    const { schedule, scheduleRun } = await newSchedule();
    env.hub.publishLive('user', {
      type: 'schedule.result',
      scheduleId: schedule.id,
      scheduleRunId: scheduleRun.id,
      runId: null,
      status: 'succeeded',
    });
    await env.push.idle();
    expect(await tokenOf(phone.id)).toBe('fcm-token-hp');
  });
});

describe('notifikasi uji', () => {
  it('sendTest ke semua perangkat Android ber-token, atau satu perangkat; hanya judul dan type=test', async () => {
    await db()
      .update(devices)
      .set({ pushToken: 'fcm-token-tablet' })
      .where(eq(devices.id, tablet.id));
    const all = await env.push.sendTest();
    expect(all.map((r) => [r.name, r.result.ok]).sort()).toEqual([
      ['HP', true],
      ['Tablet', true],
    ]);
    expect(
      fcm.sent.every((m) => m.title === 'Tes notifikasi Personal AI OS' && m.data.type === 'test'),
    ).toBe(true);
    expect(fcm.sent.every((m) => Object.keys(m.notification).join() === 'title')).toBe(true);

    fcm.sent.length = 0;
    const one = await env.push.sendTest({ deviceId: phone.id, title: 'Halo HP' });
    expect(one).toHaveLength(1);
    expect(fcm.sent.map((m) => [m.token, m.title])).toEqual([['fcm-token-hp', 'Halo HP']]);

    fcm.sent.length = 0;
    expect(await env.push.sendTest({ deviceId: desktopId })).toEqual([]); // bukan Android
    expect(await env.push.sendTest({ deviceId: revokedId })).toEqual([]); // dicabut
    expect(fcm.sent).toHaveLength(0);
  });
});

describe('tanpa FCM', () => {
  it('service tidak melakukan apa pun dan tidak melempar bila FCM tidak dikonfigurasi', async () => {
    const plain = await createAuthEnv(inject('testDatabaseUrl'));
    try {
      expect(await plain.push.sendTest()).toEqual([]);
      plain.hub.publishLive('user', {
        type: 'research.completed',
        researchId: '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f',
        runId: null,
      });
      await plain.push.idle();
    } finally {
      await plain.close();
    }
  });
});
