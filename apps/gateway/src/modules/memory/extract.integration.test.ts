import type { ServerResponse } from 'node:http';
import {
  ConversationSchema,
  MemoryListSchema,
  MemoryProposalListSchema,
  MemoryProposalSchema,
  MessageSchema,
  pageOf,
  ProblemSchema,
  RunSchema,
  SendMessageResponseSchema,
  MemorySchema,
  type UserEvent,
} from '@aios/contracts';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import {
  conversations,
  memories,
  memoryExtractions,
  memoryProposals,
  messages,
  projects,
  schedules,
  spaces,
} from '../../db/schema/index.js';
import { createAuthEnv, type AuthEnv } from '../../testing/auth-env.js';
import { startFakeHermes, type FakeHermes } from '../../testing/fake-hermes.js';
import { startFakeFcm, type FakeFcm } from '../../testing/fake-fcm.js';
import { startMockServer, type MockServer } from '../../testing/mock-server.js';
import { PENDING_MAX } from './extractor.js';

/** Penanda di jawaban asisten: tidak boleh pernah sampai ke model ekstraksi. */
const ASSISTANT_MARKER = 'JAWABAN-ASISTEN-7f3a';
const EXTRACT_MARKER = 'pengekstrak fakta memori';
const DAILY_MAX = 3;

let hermes: FakeHermes;
let router: MockServer;
/** FCM tiruan: setiap lingkungan punya satu HP Android ber-token, jadi satu push = satu pesan di `fcm.sent`. */
let fcm: FakeFcm;
/** Isi semua permintaan ke 9Router tiruan (judul otomatis juga lewat sini, dibedakan lewat prompt). */
const routerBodies: string[] = [];
let extractReply: (res: ServerResponse) => void;

const extractCalls = () => routerBodies.filter((b) => b.includes(EXTRACT_MARKER));
const answer = (content: string) => (res: ServerResponse) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }));
};
const facts = (...items: object[]) => answer(JSON.stringify({ facts: items }));

beforeAll(async () => {
  hermes = await startFakeHermes();
  fcm = await startFakeFcm();
  hermes.onRequest((s) => {
    s.delta(`Baik, dicatat. ${ASSISTANT_MARKER}`);
    s.finish();
    s.done();
  });
  router = await startMockServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      routerBodies.push(body);
      // Judul otomatis gagal (jatuh ke kata awal pesan) supaya hanya ekstraksi yang menjawab.
      if (body.includes(EXTRACT_MARKER)) extractReply(res);
      else res.writeHead(500).end();
    });
  });
});
afterAll(async () => {
  await hermes.close();
  await router.close();
  await fcm.close();
});

/** Satu lingkungan gateway per mode; tabel memori dan usulan dikosongkan tiap tes. */
function gateway(mode: 'off' | 'propose' | 'auto') {
  const ctx = {} as { env: AuthEnv; token: string; events: UserEvent[] };
  beforeAll(async () => {
    ctx.env = await createAuthEnv(inject('testDatabaseUrl'), {
      hermesUrl: hermes.url,
      ninerouterUrl: `${router.url}/v1`,
      memoryExtract: { mode, dailyMax: DAILY_MAX },
      push: { baseUrl: fcm.baseUrl, account: fcm.account },
    });
    ctx.events = [];
    ctx.env.hub.subscribe('user', ({ event }) => void ctx.events.push(event as UserEvent));
    await ctx.env.loginOk({ kind: 'android', name: 'HP', pushToken: `fcm-token-${mode}` });
  });
  afterAll(async () => {
    await ctx.env.close();
  });
  beforeEach(async () => {
    const { db } = ctx.env.database.handle;
    await db.delete(memoryProposals);
    await db.delete(memoryExtractions);
    await db.delete(memories);
    routerBodies.length = 0;
    ctx.events.length = 0;
    ctx.env.extractScheduled.length = 0;
    fcm.sent.length = 0;
    extractReply = facts();
    ctx.token = (await ctx.env.loginOk({ kind: 'desktop' })).accessToken;
  });
  return ctx;
}

async function newConversation(env: AuthEnv, token: string, body: object = {}) {
  const res = await env.post('/conversations', { surface: 'windows', ...body }, token);
  expect(res.statusCode, res.body).toBe(201);
  return ConversationSchema.parse(res.json()).id;
}

/** Mengirim pesan lewat API, menunggu run selesai, lalu menunggu ekstraksi yang dijadwalkan runner. */
async function send(env: AuthEnv, token: string, text: string, conversationId?: string) {
  const conv = conversationId ?? (await newConversation(env, token));
  const res = await env.post(
    `/conversations/${conv}/messages`,
    { parts: [{ type: 'text', text }] },
    token,
  );
  expect(res.statusCode, res.body).toBe(201);
  const sent = SendMessageResponseSchema.parse(res.json());
  // Runner melacak run sejak `launch` (sinkron di dalam POST), jadi idle() menunggu run ini selesai tanpa polling;
  // ekstraksi yang dijadwalkan runner dijalankan langsung oleh lingkungan tes dan ditunggu extractIdle().
  await env.runner.idle();
  await env.extractIdle();
  const { status } = RunSchema.parse((await env.get(`/runs/${sent.run.id}`, token)).json());
  return { conversationId: conv, runId: sent.run.id, messageId: sent.message.id, status };
}

const proposals = async (env: AuthEnv, token: string, status = '') => {
  const res = await env.get(`/memories/proposals${status ? `?status=${status}` : ''}`, token);
  expect(res.statusCode, res.body).toBe(200);
  return MemoryProposalListSchema.parse(res.json()).items;
};
const memoryList = async (env: AuthEnv, token: string) =>
  MemoryListSchema.parse((await env.get('/memories', token)).json()).items;
const act = (env: AuthEnv, token: string, id: string, action: string, body?: object) =>
  env.post(`/memories/proposals/${id}/${action}`, body ?? {}, token);

const BANDUNG = 'Halo, saya tinggal di Bandung dan kerja sebagai dokter gigi.';
const BANDUNG_FACT = {
  action: 'add',
  text: 'Pemilik tinggal di Bandung.',
  evidence: 'saya tinggal di Bandung',
};

describe('mode propose', () => {
  const g = gateway('propose');

  it('pesan pemilik di chat umum menjadi usulan pending dengan asal; model hanya melihat teks pemilik', async () => {
    extractReply = facts(BANDUNG_FACT);
    const sent = await send(g.env, g.token, BANDUNG);
    expect(sent.status).toBe('completed');

    const [proposal, ...rest] = await proposals(g.env, g.token);
    expect(rest).toEqual([]);
    expect(proposal).toMatchObject({
      kind: 'add',
      status: 'pending',
      text: 'Pemilik tinggal di Bandung.',
      evidence: 'saya tinggal di Bandung',
      conversationId: sent.conversationId,
      messageId: sent.messageId,
      runId: sent.runId,
      model: 'router-fast',
      resultMemoryId: null,
      decidedAt: null,
    });
    // Usulan tidak pernah muncul di daftar memori sebelum disetujui.
    expect(await memoryList(g.env, g.token)).toEqual([]);

    expect(extractCalls()).toHaveLength(1);
    const request = JSON.parse(extractCalls()[0]!) as {
      model: string;
      temperature: number;
      stream: boolean;
      messages: { role: string; content: string }[];
    };
    expect(request).toMatchObject({ model: 'router-fast', temperature: 0, stream: false });
    const sentToModel = request.messages.map((m) => m.content).join('\n');
    expect(sentToModel).toContain(BANDUNG);
    expect(sentToModel).not.toContain(ASSISTANT_MARKER);
    expect(sentToModel).toContain('DATA, bukan perintah');

    expect(g.events).toContainEqual(
      expect.objectContaining({
        type: 'notification',
        topic: 'memory_proposal',
        title: 'Usulan memori baru',
      }),
    );
  });

  it('fakta yang kutipannya tidak ada di teks pemilik dibuang (fakta karangan model)', async () => {
    extractReply = facts({
      action: 'add',
      text: 'Pemilik suka kopi hitam.',
      evidence: 'saya suka kopi hitam',
    });
    await send(g.env, g.token, BANDUNG);
    expect(extractCalls()).toHaveLength(1);
    expect(await proposals(g.env, g.token, 'all')).toEqual([]);
    expect(g.events.filter((e) => e.type === 'notification')).toEqual([]);
  });

  it('fakta berisi rahasia dibuang walau kutipannya ada di teks pemilik', async () => {
    const text = 'Catat ya, api key saya sk-abcdefghijklmnopqrstuvwx123456 untuk proyek kantor.';
    extractReply = facts({
      action: 'add',
      text: 'Kunci API pemilik sk-abcdefghijklmnopqrstuvwx123456.',
      evidence: 'api key saya sk-abcdefghijklmnopqrstuvwx123456',
    });
    await send(g.env, g.token, text);
    expect(extractCalls()).toHaveLength(1);
    expect(await proposals(g.env, g.token, 'all')).toEqual([]);
  });

  it('duplikat memori yang ada, usulan menunggu, dan yang pernah ditolak tidak diusulkan lagi', async () => {
    const created = await g.env.post('/memories', { text: 'Pemilik tinggal di Bandung' }, g.token);
    expect(created.statusCode).toBe(201);
    extractReply = facts(BANDUNG_FACT);
    await send(g.env, g.token, BANDUNG);
    expect(await proposals(g.env, g.token, 'all')).toEqual([]);

    await g.env.database.handle.db.delete(memories);
    const job = {
      action: 'add',
      text: 'Pemilik bekerja sebagai dokter gigi.',
      evidence: 'kerja sebagai dokter gigi',
    };
    extractReply = facts(job);
    const first = await send(g.env, g.token, BANDUNG);
    expect((await proposals(g.env, g.token)).map((p) => p.text)).toEqual([job.text]);
    // Usulan yang sama dari giliran berikutnya tidak menumpuk.
    await send(g.env, g.token, BANDUNG, first.conversationId);
    const pending = await proposals(g.env, g.token);
    expect(pending).toHaveLength(1);

    expect((await act(g.env, g.token, pending[0]!.id, 'reject')).statusCode).toBe(200);
    await send(g.env, g.token, BANDUNG);
    expect(await proposals(g.env, g.token)).toEqual([]);
    expect(extractCalls()).toHaveLength(3);
  });

  it('maksimal 2 usulan per giliran walau model mengembalikan 3', async () => {
    extractReply = facts(
      BANDUNG_FACT,
      {
        action: 'add',
        text: 'Pemilik bekerja sebagai dokter gigi.',
        evidence: 'kerja sebagai dokter gigi',
      },
      { action: 'add', text: 'Pemilik menyapa dengan halo.', evidence: 'Halo, saya tinggal' },
    );
    await send(g.env, g.token, BANDUNG);
    expect(await proposals(g.env, g.token)).toHaveLength(2);
  });

  it('push FCM: satu per giliran walau 2 usulan, hanya judul dan ID tanpa teks fakta; 0 fakta diterima = tanpa push', async () => {
    extractReply = facts(BANDUNG_FACT, {
      action: 'add',
      text: 'Pemilik bekerja sebagai dokter gigi.',
      evidence: 'kerja sebagai dokter gigi',
    });
    const sent = await send(g.env, g.token, BANDUNG);
    await g.env.push.idle();
    const pending = await proposals(g.env, g.token);
    expect(pending).toHaveLength(2);
    expect(fcm.sent).toHaveLength(1);
    const [push] = fcm.sent;
    expect(push!.token).toBe('fcm-token-propose');
    expect(push!.notification).toEqual({ title: '2 usulan memori baru' });
    expect(push!.data).toEqual({
      type: 'memory_proposal',
      conversationId: sent.conversationId,
      proposalIds: expect.any(String) as string,
    });
    expect(push!.data.proposalIds!.split(',').sort()).toEqual(pending.map((p) => p.id).sort());
    // Teks fakta, kutipan, dan pesan pemilik tidak pernah lewat Google.
    expect(JSON.stringify(fcm.sent)).not.toMatch(/Bandung|dokter|tinggal/);

    // Giliran berikutnya: model mengembalikan fakta yang sama (duplikat usulan menunggu) = 0 diterima.
    fcm.sent.length = 0;
    await send(g.env, g.token, BANDUNG, sent.conversationId);
    await g.env.push.idle();
    expect(extractCalls()).toHaveLength(2);
    expect(fcm.sent).toEqual([]);

    // Model tidak mengembalikan fakta sama sekali.
    extractReply = facts();
    await send(g.env, g.token, BANDUNG);
    await g.env.push.idle();
    expect(fcm.sent).toEqual([]);
  });

  it('batas harian panggilan model: setelah habis, model tidak dipanggil lagi sampai jendela 24 jam lewat', async () => {
    extractReply = facts();
    for (let i = 0; i < DAILY_MAX; i += 1) await send(g.env, g.token, BANDUNG);
    expect(extractCalls()).toHaveLength(DAILY_MAX);
    await send(g.env, g.token, BANDUNG);
    expect(extractCalls()).toHaveLength(DAILY_MAX);

    g.env.clock.now += 24 * 60 * 60 * 1000 + 1000;
    g.token = (await g.env.loginOk({ kind: 'desktop' })).accessToken;
    await send(g.env, g.token, BANDUNG);
    expect(extractCalls()).toHaveLength(DAILY_MAX + 1);
  });

  it(`usulan menunggu sebanyak ${PENDING_MAX} menghentikan ekstraksi tanpa memanggil model`, async () => {
    await g.env.database.handle.db.insert(memoryProposals).values(
      Array.from({ length: PENDING_MAX }, (_, i) => ({
        kind: 'add' as const,
        text: `Fakta lama ${i}`,
        evidence: 'x',
        model: 'router-fast',
      })),
    );
    extractReply = facts(BANDUNG_FACT);
    await send(g.env, g.token, BANDUNG);
    expect(extractCalls()).toEqual([]);
  });

  it('pesan tanpa penanda tentang pemilik tidak memanggil model', async () => {
    await send(g.env, g.token, 'Ringkas artikel berikut dalam tiga poin pendek.');
    expect(g.env.extractScheduled).toHaveLength(1);
    expect(extractCalls()).toEqual([]);
  });

  it('percakapan ruang tidak dijadwalkan; project, tim, dan jadwal dilewati tanpa panggilan model', async () => {
    const { db } = g.env.database.handle;
    const [space] = await db.insert(spaces).values({ name: 'Riset' }).returning();
    const spaceConv = await newConversation(g.env, g.token, { spaceId: space!.id });
    extractReply = facts(BANDUNG_FACT);
    await send(g.env, g.token, BANDUNG, spaceConv);
    expect(g.env.extractScheduled).toEqual([]);
    expect(await g.env.memoryProposals.extract(spaceConv)).toBe(0);

    const worker = await g.env.loginOk({ kind: 'worker', name: 'PC worker' });
    const [project] = await db
      .insert(projects)
      .values({
        name: 'toko',
        workerDeviceId: worker.device.id,
        stack: { languages: ['typescript'], frameworks: [] },
      })
      .returning();
    const general = async (patch: Partial<typeof conversations.$inferInsert>) => {
      const [conv] = await db
        .insert(conversations)
        .values({ surface: 'windows', ...patch })
        .returning();
      await db.insert(messages).values({
        conversationId: conv!.id,
        author: 'user',
        parts: [{ type: 'text', text: BANDUNG }],
      });
      return conv!.id;
    };
    const projectConv = await general({ projectId: project!.id });
    const teamConv = await general({ teamId: '019a0000-0000-7000-8000-000000000001' });
    const scheduleConv = await general({});
    await db.insert(schedules).values({
      name: 'Pagi',
      cron: '0 7 * * *',
      prompt: BANDUNG,
      target: 'chat',
      conversationId: scheduleConv,
    });
    for (const conv of [projectConv, teamConv, scheduleConv]) {
      expect(await g.env.memoryProposals.extract(conv)).toBe(0);
    }
    expect(extractCalls()).toEqual([]);

    // Kontrol: percakapan umum yang sama bentuknya memang diekstrak.
    const plain = await general({});
    expect(await g.env.memoryProposals.extract(plain)).toBe(1);
  });

  it('kegagalan ekstraksi (9Router 500, JSON rusak, penjadwal melempar) tidak mengubah hasil run', async () => {
    const assistantText = async (conversationId: string) => {
      const list = pageOf(MessageSchema).parse(
        (await g.env.get(`/conversations/${conversationId}/messages`, g.token)).json(),
      );
      const last = list.items.at(-1)!;
      return last.parts.map((p) => (p.type === 'text' ? p.text : '')).join('');
    };

    extractReply = (res) => void res.writeHead(500).end();
    const failed = await send(g.env, g.token, BANDUNG);
    expect(failed.status).toBe('completed');
    expect(await assistantText(failed.conversationId)).toContain(ASSISTANT_MARKER);

    extractReply = answer('bukan json');
    const invalid = await send(g.env, g.token, BANDUNG);
    expect(invalid.status).toBe('completed');

    const original = g.env.memoryProposals.schedule.bind(g.env.memoryProposals);
    g.env.memoryProposals.schedule = () => Promise.reject(new Error('antrean mati'));
    try {
      const thrown = await send(g.env, g.token, BANDUNG);
      expect(thrown.status).toBe('completed');
      expect(await assistantText(thrown.conversationId)).toContain(ASSISTANT_MARKER);
    } finally {
      g.env.memoryProposals.schedule = original;
    }

    expect(await proposals(g.env, g.token, 'all')).toEqual([]);
    const outcomes = await g.env.database.handle.db
      .select({ outcome: memoryExtractions.outcome })
      .from(memoryExtractions);
    expect(outcomes.map((o) => o.outcome).sort()).toEqual(['failed', 'invalid']);
  });
});

describe('mode propose: setuju, sunting, tolak', () => {
  const g = gateway('propose');

  const pendingOne = async (fact: object = BANDUNG_FACT, text = BANDUNG) => {
    extractReply = facts(fact);
    const sent = await send(g.env, g.token, text);
    const [proposal] = await proposals(g.env, g.token);
    return { proposal: proposal!, sent };
  };

  it('setuju membuat memori source extracted dengan asal percakapan; persetujuan kedua 409', async () => {
    const { proposal, sent } = await pendingOne();
    const res = await act(g.env, g.token, proposal.id, 'approve');
    expect(res.statusCode, res.body).toBe(200);
    const approved = MemoryProposalSchema.parse(res.json());
    expect(approved.status).toBe('approved');
    expect(approved.decidedAt).not.toBeNull();

    const [memory, ...rest] = await memoryList(g.env, g.token);
    expect(rest).toEqual([]);
    expect(memory).toMatchObject({
      id: approved.resultMemoryId,
      text: 'Pemilik tinggal di Bandung.',
      enabled: true,
      source: 'extracted',
      origin: { conversationId: sent.conversationId, messageId: sent.messageId },
    });

    const again = await act(g.env, g.token, proposal.id, 'approve');
    expect(again.statusCode).toBe(409);
    expect(ProblemSchema.parse(again.json()).code).toBe('proposal_decided');
    expect(await memoryList(g.env, g.token)).toHaveLength(1);
  });

  it('dua persetujuan bersamaan: tepat satu berhasil, satu 409, satu memori', async () => {
    const { proposal } = await pendingOne();
    const results = await Promise.all(
      Array.from({ length: 4 }, () => act(g.env, g.token, proposal.id, 'approve')),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409, 409, 409]);
    expect(await memoryList(g.env, g.token)).toHaveLength(1);
  });

  it('ubah lalu simpan memakai teks suntingan', async () => {
    const { proposal } = await pendingOne();
    const res = await act(g.env, g.token, proposal.id, 'approve', {
      text: '  Pemilik tinggal di Dago, Bandung.  ',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(MemoryProposalSchema.parse(res.json()).text).toBe('Pemilik tinggal di Dago, Bandung.');
    expect((await memoryList(g.env, g.token)).map((m) => m.text)).toEqual([
      'Pemilik tinggal di Dago, Bandung.',
    ]);
    // Teks suntingan kosong ditolak validasi sebelum status diperiksa.
    expect((await act(g.env, g.token, proposal.id, 'approve', { text: ' ' })).statusCode).toBe(400);
  });

  it('tolak: status rejected, tidak ada memori, tidak bisa disetujui atau diurungkan setelahnya', async () => {
    const { proposal } = await pendingOne();
    const res = await act(g.env, g.token, proposal.id, 'reject');
    expect(res.statusCode, res.body).toBe(200);
    expect(MemoryProposalSchema.parse(res.json()).status).toBe('rejected');
    expect(await memoryList(g.env, g.token)).toEqual([]);
    expect((await act(g.env, g.token, proposal.id, 'approve')).statusCode).toBe(409);
    expect((await act(g.env, g.token, proposal.id, 'reject')).statusCode).toBe(409);
    expect((await act(g.env, g.token, proposal.id, 'undo')).statusCode).toBe(409);
    expect((await proposals(g.env, g.token, 'rejected')).map((p) => p.id)).toEqual([proposal.id]);
  });

  it('usulan update: setuju mengganti teks memori target dan menyimpan teks lama', async () => {
    const created = await g.env.post('/memories', { text: 'Pemilik tinggal di Jakarta.' }, g.token);
    const targetId = MemorySchema.parse(created.json()).id;
    const text = 'Update: sekarang saya tinggal di Bandung, bukan lagi di ibu kota.';
    const { proposal } = await pendingOne(
      {
        action: 'update',
        target: 'm1',
        text: 'Pemilik tinggal di Bandung.',
        evidence: 'sekarang saya tinggal di Bandung',
      },
      text,
    );
    expect(proposal).toMatchObject({
      kind: 'update',
      targetMemoryId: targetId,
      targetText: 'Pemilik tinggal di Jakarta.',
    });
    const res = await act(g.env, g.token, proposal.id, 'approve');
    expect(res.statusCode, res.body).toBe(200);
    expect(MemoryProposalSchema.parse(res.json())).toMatchObject({
      previousText: 'Pemilik tinggal di Jakarta.',
      resultMemoryId: targetId,
    });
    expect((await memoryList(g.env, g.token)).map((m) => [m.id, m.text])).toEqual([
      [targetId, 'Pemilik tinggal di Bandung.'],
    ]);
  });

  it('id tidak dikenal 404; id bukan uuid 400; tanpa token 401', async () => {
    const missing = await act(g.env, g.token, '019a0000-0000-7000-8000-00000000abcd', 'approve');
    expect(missing.statusCode).toBe(404);
    expect(ProblemSchema.parse(missing.json()).code).toBe('proposal_not_found');
    expect((await act(g.env, g.token, 'bukan-uuid', 'reject')).statusCode).toBe(400);
    expect((await g.env.get('/memories/proposals')).statusCode).toBe(401);
    expect((await g.env.get('/memories/proposals?status=semua', g.token)).statusCode).toBe(400);
  });
});

describe('mode auto', () => {
  const g = gateway('auto');

  it('langsung tersimpan dengan asal terlihat; urungkan menghapusnya dan fakta itu tidak diusulkan lagi', async () => {
    extractReply = facts(BANDUNG_FACT);
    const sent = await send(g.env, g.token, BANDUNG);
    const [memory] = await memoryList(g.env, g.token);
    expect(memory).toMatchObject({
      text: 'Pemilik tinggal di Bandung.',
      source: 'extracted',
      origin: { conversationId: sent.conversationId, messageId: sent.messageId },
    });
    expect(await proposals(g.env, g.token)).toEqual([]);
    const [saved] = await proposals(g.env, g.token, 'auto_saved');
    expect(saved).toMatchObject({ status: 'auto_saved', resultMemoryId: memory!.id });
    expect(g.events).toContainEqual(
      expect.objectContaining({
        topic: 'memory_proposal',
        title: 'Disimpan ke memori: Pemilik tinggal di Bandung.',
      }),
    );

    const res = await act(g.env, g.token, saved!.id, 'undo');
    expect(res.statusCode, res.body).toBe(200);
    expect(MemoryProposalSchema.parse(res.json()).status).toBe('undone');
    expect(await memoryList(g.env, g.token)).toEqual([]);
    expect((await act(g.env, g.token, saved!.id, 'undo')).statusCode).toBe(409);

    await send(g.env, g.token, BANDUNG);
    expect(await memoryList(g.env, g.token)).toEqual([]);
  });

  it('update otomatis: urungkan mengembalikan teks lama memori target', async () => {
    const created = await g.env.post('/memories', { text: 'Pemilik tinggal di Jakarta.' }, g.token);
    const targetId = MemorySchema.parse(created.json()).id;
    extractReply = facts({
      action: 'update',
      target: 'm1',
      text: 'Pemilik tinggal di Bandung.',
      evidence: 'saya tinggal di Bandung',
    });
    await send(g.env, g.token, BANDUNG);
    expect((await memoryList(g.env, g.token)).map((m) => m.text)).toEqual([
      'Pemilik tinggal di Bandung.',
    ]);
    const [saved] = await proposals(g.env, g.token, 'auto_saved');
    expect(saved).toMatchObject({ kind: 'update', previousText: 'Pemilik tinggal di Jakarta.' });
    expect((await act(g.env, g.token, saved!.id, 'undo')).statusCode).toBe(200);
    expect((await memoryList(g.env, g.token)).map((m) => [m.id, m.text])).toEqual([
      [targetId, 'Pemilik tinggal di Jakarta.'],
    ]);
  });

  it('usulan pending tidak bisa diurungkan; auto_saved tidak bisa disetujui', async () => {
    extractReply = facts(BANDUNG_FACT);
    await send(g.env, g.token, BANDUNG);
    const [saved] = await proposals(g.env, g.token, 'auto_saved');
    expect((await act(g.env, g.token, saved!.id, 'approve')).statusCode).toBe(409);
    const [pending] = await g.env.database.handle.db
      .insert(memoryProposals)
      .values({ kind: 'add', text: 'Fakta lain', evidence: 'x', model: 'router-fast' })
      .returning();
    const undo = await act(g.env, g.token, pending!.id, 'undo');
    expect(undo.statusCode).toBe(409);
    expect(ProblemSchema.parse(undo.json()).code).toBe('proposal_not_undoable');
  });

  it('status=review: pending ditambah auto_saved/undone 7 hari terakhir; urungkan tampil sebagai undone; tanpa push', async () => {
    extractReply = facts(BANDUNG_FACT);
    await send(g.env, g.token, BANDUNG);
    await g.env.push.idle();
    // Mode auto tidak mengirim push (bukan usulan yang menunggu keputusan).
    expect(fcm.sent).toEqual([]);

    const { db } = g.env.database.handle;
    const old = new Date(g.env.clock.now - 8 * 24 * 60 * 60 * 1000);
    const [stale] = await db
      .insert(memoryProposals)
      .values({
        kind: 'add',
        status: 'auto_saved',
        text: 'Fakta lama',
        evidence: 'x',
        model: 'router-fast',
        createdAt: old,
        decidedAt: old,
      })
      .returning();
    const [waiting] = await db
      .insert(memoryProposals)
      .values({ kind: 'add', text: 'Fakta menunggu', evidence: 'x', model: 'router-fast' })
      .returning();
    await db.insert(memoryProposals).values({
      kind: 'add',
      status: 'rejected',
      text: 'Fakta ditolak',
      evidence: 'x',
      model: 'router-fast',
    });

    const review = await proposals(g.env, g.token, 'review');
    const saved = review.find((p) => p.status === 'auto_saved');
    expect(saved).toMatchObject({ text: 'Pemilik tinggal di Bandung.' });
    expect(review.map((p) => p.id).sort()).toEqual([saved!.id, waiting!.id].sort());
    expect(review.map((p) => p.id)).not.toContain(stale!.id);

    const memoriesBefore = await memoryList(g.env, g.token);
    expect(memoriesBefore.map((m) => m.id)).toEqual([saved!.resultMemoryId]);
    expect((await act(g.env, g.token, saved!.id, 'undo')).statusCode).toBe(200);
    expect(await memoryList(g.env, g.token)).toEqual([]);
    const after = await proposals(g.env, g.token, 'review');
    expect(after.find((p) => p.id === saved!.id)?.status).toBe('undone');
    const again = await act(g.env, g.token, saved!.id, 'undo');
    expect(again.statusCode).toBe(409);
    expect(ProblemSchema.parse(again.json()).code).toBe('proposal_not_undoable');
  });
});

describe('mode off', () => {
  const g = gateway('off');

  it('tidak ada pekerjaan dan tidak ada panggilan model; daftar usulan tetap bisa dibaca', async () => {
    extractReply = facts(BANDUNG_FACT);
    const sent = await send(g.env, g.token, BANDUNG);
    expect(sent.status).toBe('completed');
    expect(g.env.extractScheduled).toEqual([]);
    expect(await g.env.memoryProposals.extract(sent.conversationId)).toBe(0);
    expect(extractCalls()).toEqual([]);
    expect(await proposals(g.env, g.token, 'all')).toEqual([]);
    const rows = await g.env.database.handle.db
      .select()
      .from(memoryExtractions)
      .where(eq(memoryExtractions.conversationId, sent.conversationId));
    expect(rows).toEqual([]);
    await g.env.push.idle();
    expect(fcm.sent).toEqual([]);
  });
});
