import {
  ConversationSchema,
  RunSchema,
  SendMessageResponseSchema,
  SkillCuratorReportResponseSchema,
  SkillCuratorReportSchema,
  SkillListSchema,
  SkillProposalListSchema,
  SkillVersionListSchema,
  type ServerEvent,
} from '@aios/contracts';
import { sql } from 'drizzle-orm';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createAuthEnv, type AuthEnv } from '../../testing/auth-env.js';
import { startFakeHermes, type FakeHermes, type FakeStream } from '../../testing/fake-hermes.js';
import {
  CURATOR_CRON,
  CURATOR_QUEUE,
  HERMES_WATCH_CRON,
  HERMES_WATCH_QUEUE,
  startSkillJobs,
} from './jobs.js';

/**
 * Kurator skill (P11) dengan waktu palsu. Jam palsu `clock` dipasang relatif terhadap waktu nyata karena
 * `created_at` skill memakai jam database nyata; login ulang tiap melompat (JWT memakai jam palsu).
 * Larangan yang dibuktikan: tidak pernah menghapus, bawaan/disematkan/terpasang tidak disentuh,
 * skill buatan sendiri hanya diberi tanda, saran gabung tidak menggabungkan apa pun.
 */
const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.now();
const fence = (o: unknown) => '```aios-skill-proposal\n' + JSON.stringify(o) + '\n```';
const block = (name: string, description: string) => ({
  kind: 'new',
  name,
  description,
  body: '1. Baca konteks.\n2. Kerjakan langkah utama.',
  reason: 'Berulang dan bisa dipakai ulang.',
});

let env: AuthEnv;
let hermes: FakeHermes;
let hermesRoot: string;
let token = '';
const events: ServerEvent[] = [];

const at = async (days: number) => {
  env.clock.now = T0 + days * DAY;
  token = (await env.loginOk({ kind: 'desktop' })).accessToken;
};
const run = async () =>
  SkillCuratorReportSchema.parse((await env.post('/skills/curator/run', {}, token)).json());
const skillsAll = async () =>
  SkillListSchema.parse((await env.get('/skills?include=all', token)).json()).items;
const one = async (id: string) => (await skillsAll()).find((s) => s.id === id);
const rowCount = async () => {
  const r = await env.database.handle.db.execute<{ n: number }>(
    sql`select count(*)::int as n from catalog_skills`,
  );
  return r.rows[0]!.n;
};

/** Satu giliran chat dengan Hermes tiruan; `script` mengisi stream. */
async function chat(script: (s: FakeStream) => void) {
  hermes.onRequest((s) => {
    script(s);
    s.finish();
    s.done();
  });
  const conv = ConversationSchema.parse(
    (await env.post('/conversations', { surface: 'windows' }, token)).json(),
  );
  const sent = SendMessageResponseSchema.parse(
    (
      await env.post(
        `/conversations/${conv.id}/messages`,
        { parts: [{ type: 'text', text: 'Kerjakan.' }] },
        token,
      )
    ).json(),
  );
  for (let i = 0; i < 1500; i += 1) {
    const status = RunSchema.parse((await env.get(`/runs/${sent.run.id}`, token)).json()).status;
    if (['completed', 'failed', 'cancelled'].includes(status)) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  return { runId: sent.run.id, conversationId: conv.id };
}

/** Membuat skill sumber `agent` lewat jalur usulan -> setujui, seperti di pemakaian nyata. */
async function agentSkill(name: string, description: string) {
  const { conversationId } = await chat((s) => s.delta(fence(block(name, description))));
  const [p] = SkillProposalListSchema.parse(
    (await env.get(`/skills/proposals?conversationId=${conversationId}`, token)).json(),
  ).items;
  expect(p, `usulan ${name}`).toBeDefined();
  const res = await env.post(`/skills/proposals/${p!.id}/approve`, {}, token);
  expect(res.statusCode, res.body).toBe(200);
  return res.json<{ id: string }>().id;
}

beforeAll(async () => {
  hermes = await startFakeHermes();
  hermesRoot = await mkdtemp(join(tmpdir(), 'aios-p11-curator-'));
  env = await createAuthEnv(inject('testDatabaseUrl'), {
    hermesUrl: hermes.url,
    skillInstall: { hermesRoot },
    skillProposalsPerDay: 50,
  });
  env.hub.subscribe('user', ({ event }) => events.push(event));
  await at(0);
});
afterAll(async () => {
  await env.close();
  await hermes.close();
  await rm(hermesRoot, { recursive: true, force: true });
});

describe('kurator skill: tanda usang 30 hari, arsip 90 hari', () => {
  const ids: Record<string, string> = {};
  const builtinBefore = new Map<string, string | undefined>();

  beforeAll(async () => {
    ids.agentOld = await agentSkill('Agent lama', 'Saat mengurus berkas arsip tahunan keuangan.');
    ids.agentPinned = await agentSkill(
      'Agent disematkan',
      'Saat menyiapkan laporan penjualan kuartalan.',
    );
    ids.agentOpened = await agentSkill('Agent dibuka', 'Saat menandai tiket bug prioritas tinggi.');
    const pin = await env.app.inject({
      method: 'PATCH',
      url: `/v1/skills/${ids.agentPinned}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { pinned: true },
    });
    expect(pin.statusCode, pin.body).toBe(200);

    const created = async (name: string, description: string) => {
      const res = await env.post('/skills', { name, description, body: 'isi' }, token);
      expect(res.statusCode, res.body).toBe(201);
      return res.json<{ id: string }>().id;
    };
    ids.user = await created('Buatan sendiri', 'Saat merapikan catatan rapat mingguan tim.');
    ids.dup1 = await created(
      'Rapikan changelog satu',
      'Saat merapikan changelog rilis: kelompokkan perubahan per jenis dan tulis satu baris.',
    );
    ids.dup2 = await created(
      'Rapikan changelog dua',
      'Saat merapikan changelog rilis, kelompokkan perubahan per jenis lalu tulis satu baris.',
    );

    await mkdir(join(hermesRoot, 'ext'), { recursive: true });
    await writeFile(
      join(hermesRoot, 'ext', 'SKILL.md'),
      '---\nname: terpasang-luar\ndescription: Saat mengelola langganan perangkat lunak.\n---\nisi\n',
    );
    const imp = await env.post('/skills/hermes/import', { name: 'terpasang-luar' }, token);
    expect(imp.statusCode, imp.body).toBe(201);
    ids.installed = 'terpasang-luar';

    for (const s of (await skillsAll()).filter((x) => x.source === 'builtin')) {
      builtinBefore.set(s.id, s.status);
    }
  });

  it('di bawah 30 hari tidak ada yang disentuh; run kurator hanya menyusun laporan', async () => {
    await at(29);
    const total = await rowCount();
    const report = await run();
    expect(report.markedStale).toEqual([]);
    expect(report.archived).toEqual([]);
    expect(await rowCount()).toBe(total);
    for (const s of await skillsAll()) expect(s.staleSince ?? null, s.id).toBeNull();
  });

  it('30 hari: skill agent dan buatan sendiri ditandai usang; disematkan, terpasang, bawaan tidak', async () => {
    await at(31);
    const report = await run();
    const stale = new Set(report.markedStale.map((s) => s.id));
    for (const id of [ids.agentOld, ids.agentOpened, ids.user, ids.dup1, ids.dup2]) {
      expect(stale.has(id!), id).toBe(true);
    }
    expect(stale.has(ids.agentPinned!)).toBe(false);
    expect(stale.has(ids.installed!)).toBe(false);
    for (const s of await skillsAll()) {
      if (s.source === 'builtin') expect(s.staleSince ?? null, s.id).toBeNull();
    }
    // Hanya tanda: semua masih aktif.
    for (const id of [ids.agentOld, ids.user]) expect((await one(id!))?.status).toBe('active');
    expect((await one(ids.agentOld!))?.staleSince).toBeTruthy();
    expect((await one(ids.agentPinned!))?.staleSince ?? null).toBeNull();

    // Run kedua pada hari yang sama tidak menandai ulang.
    expect((await run()).markedStale).toEqual([]);
  });

  it('skill yang dibuka agent kembali dianggap hidup: tanda usang hilang dan masuk "paling sering dibuka"', async () => {
    const { runId } = await chat((s) => {
      s.toolProgress({
        tool: 'skill_view',
        label: `aios-${ids.agentOpened}`,
        toolCallId: 'c1',
        status: 'running',
      });
      s.toolProgress({ tool: 'skill_view', toolCallId: 'c1', status: 'completed' });
      s.delta('selesai');
    });
    const rows = await env.database.handle.db.execute<{ skill_id: string; run_id: string }>(
      sql`select skill_id, run_id from skill_opens`,
    );
    expect(rows.rows).toEqual([{ skill_id: ids.agentOpened, run_id: runId }]);
    expect((await one(ids.agentOpened!))?.staleSince ?? null).toBeNull();

    await at(33);
    const report = await run();
    expect(report.mostUsed).toEqual([{ id: ids.agentOpened, name: 'Agent dibuka', opens: 1 }]);
    // Sudah dibuka, jadi tidak lagi "belum pernah dibuka"; yang lain masih.
    expect(report.neverOpened.map((s) => s.id)).not.toContain(ids.agentOpened);
    expect(report.neverOpened.map((s) => s.id)).toContain(ids.agentOld);
  });

  it('89 hari: belum diarsipkan. 90+ hari: hanya skill agent yang tidak dibuka diarsipkan; tidak ada yang dihapus', async () => {
    await at(89);
    expect((await run()).archived).toEqual([]);
    expect((await one(ids.agentOld!))?.status).toBe('active');

    const total = await rowCount();
    await at(91);
    const report = await run();
    expect(report.archived.map((s) => s.id)).toEqual([ids.agentOld]);
    expect(report.archived[0]?.days).toBeGreaterThanOrEqual(90);

    expect((await one(ids.agentOld!))?.status).toBe('archived');
    // Hanya tanda: skill buatan sendiri tetap aktif walau 91 hari; disematkan dan terpasang tidak disentuh.
    expect((await one(ids.user!))?.status).toBe('active');
    expect((await one(ids.user!))?.staleSince).toBeTruthy();
    expect((await one(ids.agentPinned!))?.status).toBe('active');
    expect((await one(ids.agentPinned!))?.staleSince ?? null).toBeNull();
    expect((await one(ids.installed!))?.status).toBe('active');
    // Yang dibuka 60 hari lalu hanya usang, belum diarsipkan.
    expect((await one(ids.agentOpened!))?.status).toBe('active');
    // Bawaan repo utuh.
    for (const s of (await skillsAll()).filter((x) => x.source === 'builtin')) {
      expect(s.status, s.id).toBe(builtinBefore.get(s.id));
      expect(s.staleSince ?? null, s.id).toBeNull();
    }

    // Tidak pernah menghapus: baris dan riwayat versi masih ada; skill arsip tidak terlihat agent.
    expect(await rowCount()).toBe(total);
    expect(
      SkillVersionListSchema.parse(
        (await env.get(`/skills/${ids.agentOld}/versions`, token)).json(),
      ).items,
    ).toHaveLength(1);
    const workerToken = (await env.loginOk({ kind: 'worker' })).accessToken;
    expect((await env.get(`/skills/${ids.agentOld}`, workerToken)).statusCode).toBe(404);
  });

  it('dipulihkan dari arsip: umurnya dihitung ulang, kurator tidak mengarsipkannya lagi', async () => {
    const res = await env.post(`/skills/${ids.agentOld}/status`, { status: 'active' }, token);
    expect(res.statusCode, res.body).toBe(200);
    expect((await one(ids.agentOld!))?.status).toBe('active');
    expect((await one(ids.agentOld!))?.staleSince ?? null).toBeNull();
    const report = await run();
    expect(report.archived).toEqual([]);
    expect(report.markedStale.map((s) => s.id)).not.toContain(ids.agentOld);
    expect((await one(ids.agentOld!))?.status).toBe('active');
  });

  it('saran gabung: pasangan deskripsi sangat mirip dilaporkan, tidak digabung, bawaan dengan bawaan dikecualikan', async () => {
    const before = await rowCount();
    const report = await run();
    const pair = report.mergeSuggestions.find(
      (m) => new Set([m.a.id, m.b.id]).size === 2 && [m.a.id, m.b.id].includes(ids.dup1!),
    );
    expect(pair).toBeDefined();
    expect([pair!.a.id, pair!.b.id].sort()).toEqual([ids.dup1, ids.dup2].sort());
    expect(pair!.similarity).toBeGreaterThanOrEqual(0.6);
    // Tidak ada yang digabung: kedua skill masih ada dengan isi masing-masing.
    expect(await one(ids.dup1!)).toBeDefined();
    expect(await one(ids.dup2!)).toBeDefined();
    expect(await rowCount()).toBe(before);
    // Pasangan bawaan-bawaan tidak pernah disarankan (tidak bisa diubah pemilik).
    const builtinIds = new Set(
      (await skillsAll()).filter((s) => s.source === 'builtin').map((s) => s.id),
    );
    for (const m of report.mergeSuggestions) {
      expect(builtinIds.has(m.a.id) && builtinIds.has(m.b.id)).toBe(false);
    }
  });

  it('laporan: usulan menunggu dihitung, tersimpan, bisa dibaca ulang, dan dikirim sebagai notifikasi', async () => {
    const { conversationId } = await chat((s) =>
      s.delta(fence(block('Usulan menunggu', 'Saat menulis catatan rilis mingguan.'))),
    );
    expect(conversationId).toBeTruthy();
    const before = events.length;
    const report = await run();
    expect(report.pendingProposals).toBeGreaterThanOrEqual(1);
    expect(report.summary).toContain('Usulan menunggu keputusan');

    const latest = SkillCuratorReportResponseSchema.parse(
      (await env.get('/skills/curator/report', token)).json(),
    );
    expect(latest.report).toEqual(report);

    const note = events
      .slice(before)
      .find((e) => e.type === 'notification' && e.topic === 'skill_report');
    expect(note).toMatchObject({
      type: 'notification',
      title: 'Laporan skill mingguan',
      level: 'info',
      body: report.summary,
    });
  });
});

describe('jadwal kurator dan pemantau Hermes (pg-boss)', () => {
  it('antrean terdaftar dengan cron mingguan dan 15 menit, dan pekerja berjalan tanpa menghapus apa pun', async () => {
    const boss = new PgBoss({
      connectionString: env.database.url,
      schema: 'pgboss_p11',
      max: 2,
    });
    await boss.start();
    try {
      await startSkillJobs({ boss, curator: env.skillCurator, proposals: env.skillProposals });
      const weekly = await boss.getSchedules(CURATOR_QUEUE);
      const watch = await boss.getSchedules(HERMES_WATCH_QUEUE);
      expect(weekly.map((s) => s.cron)).toEqual([CURATOR_CRON]);
      expect(watch.map((s) => s.cron)).toEqual([HERMES_WATCH_CRON]);
      expect(CURATOR_CRON).toBe('0 3 * * 1');
      // Memulai ulang (gateway restart) tidak menggandakan jadwal.
      await startSkillJobs({ boss, curator: env.skillCurator, proposals: env.skillProposals });
      expect(await boss.getSchedules(CURATOR_QUEUE)).toHaveLength(1);
    } finally {
      await boss.stop({ graceful: false, timeout: 5000 }).catch(() => undefined);
    }
  }, 60_000);
});
