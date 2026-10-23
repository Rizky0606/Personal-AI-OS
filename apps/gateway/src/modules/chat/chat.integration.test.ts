import {
  AgentEventSchema,
  ConversationSchema,
  MessageSchema,
  ProblemSchema,
  RunEventsResponseSchema,
  RunSchema,
  SendMessageResponseSchema,
  type AgentEvent,
} from '@aios/contracts';
import { eq } from 'drizzle-orm';
import type { ServerResponse } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { conversations, messages, runEvents, runs } from '../../db/schema/index.js';
import { createAuthEnv, type AuthEnv } from '../../testing/auth-env.js';
import { startFakeHermes, type FakeHermes } from '../../testing/fake-hermes.js';
import { startMockServer, type MockServer } from '../../testing/mock-server.js';

let env: AuthEnv;
let hermes: FakeHermes;
let router: MockServer;
let routerReply: (res: ServerResponse, body: string) => void;
/** Isi semua request ke 9Router tiruan: judul dan routing dibedakan lewat prompt-nya. */
const routerBodies: string[] = [];
const titleRequests = () => routerBodies.filter((b) => b.includes('Buat judul percakapan'));
let token: string;

beforeAll(async () => {
  hermes = await startFakeHermes();
  router = await startMockServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      routerBodies.push(body);
      routerReply(res, body);
    });
  });
  env = await createAuthEnv(inject('testDatabaseUrl'), {
    hermesUrl: hermes.url,
    ninerouterUrl: `${router.url}/v1`,
  });
  token = (await env.loginOk({ kind: 'desktop' })).accessToken;
});
afterAll(async () => {
  await env.close();
  await hermes.close();
  await router.close();
});
beforeEach(() => {
  hermes.requests.length = 0;
  routerBodies.length = 0;
  // Router dan judul otomatis gagal secara default (9Router tiruan membalas 500), kecuali tes mengaturnya.
  routerReply = (res) => res.writeHead(500).end();
});

const problem = (res: { json(): unknown }) => ProblemSchema.parse(res.json());
const createConversation = async (body: object = { surface: 'windows' }) => {
  const res = await env.post('/conversations', body, token);
  expect(res.statusCode).toBe(201);
  return ConversationSchema.parse(res.json());
};
const send = async (conversationId: string, text: string) => {
  const res = await env.post(
    `/conversations/${conversationId}/messages`,
    { parts: [{ type: 'text', text }] },
    token,
  );
  expect(res.statusCode, res.body).toBe(201);
  return SendMessageResponseSchema.parse(res.json());
};
const getRun = async (id: string) => RunSchema.parse((await env.get(`/runs/${id}`, token)).json());
const until = async <T>(read: () => Promise<T>, ok: (v: T) => boolean, ms = 30_000): Promise<T> => {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = await read();
    if (ok(v) || Date.now() > deadline) return v;
    await new Promise((r) => setTimeout(r, 20));
  }
};
/** Baris run lebih dulu final daripada event penutupnya; tunggu keduanya supaya pembacaan event stabil. */
const finalRun = async (id: string) => {
  const run = await until(
    () => getRun(id),
    (r) => ['completed', 'failed', 'cancelled'].includes(r.status),
  );
  await until(
    async () => (await storedEvents(id)).at(-1),
    (e) => e?.type === 'run.status' && e.status === run.status,
  );
  return run;
};
const storedEvents = async (runId: string): Promise<AgentEvent[]> => {
  const rows = await env.database.handle.db
    .select()
    .from(runEvents)
    .where(eq(runEvents.runId, runId))
    .orderBy(runEvents.seq);
  return rows.map((r) => r.payload);
};

/** Hermes tiruan yang menjawab penuh sekaligus. */
const answer = (text: string) =>
  hermes.onRequest((s) => {
    s.delta(text.slice(0, 3));
    s.delta(text.slice(3));
    s.finish();
    s.usage(10, 4);
    s.done();
  });

describe('percakapan', () => {
  it('membuat, mendaftar (terbaru dulu, berhalaman), mengubah, dan mengarsipkan', async () => {
    const a = await createConversation({ surface: 'android', title: '  Awal  ' });
    const b = await createConversation();
    const c = await createConversation();
    expect(a.title).toBe('Awal');
    expect(b).toMatchObject({ title: '', pinned: false, archivedAt: null, projectId: null });
    expect(JSON.stringify(b)).not.toContain('hermes');

    const page1 = (await env.get('/conversations?limit=2', token)).json<{
      items: { id: string }[];
      nextBefore: string | null;
    }>();
    expect(page1.items.map((i) => i.id)).toEqual([c.id, b.id]);
    expect(page1.nextBefore).toBe(b.id);
    const page2 = (await env.get(`/conversations?limit=2&before=${page1.nextBefore}`, token)).json<{
      items: { id: string }[];
      nextBefore: string | null;
    }>();
    expect(page2.items.map((i) => i.id)).toEqual([a.id]);
    expect(page2.nextBefore).toBeNull();

    const patched = await env.app.inject({
      method: 'PATCH',
      url: `/v1/conversations/${b.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: 'Ganti', pinned: true },
    });
    expect(ConversationSchema.parse(patched.json())).toMatchObject({
      title: 'Ganti',
      pinned: true,
    });

    expect((await env.del(`/conversations/${a.id}`, token)).statusCode).toBe(204);
    const active = (await env.get('/conversations?limit=100', token)).json<{
      items: { id: string }[];
    }>();
    expect(active.items.map((i) => i.id)).not.toContain(a.id);
    const archived = (await env.get('/conversations?archived=true', token)).json<{
      items: { id: string; archivedAt: string | null }[];
    }>();
    expect(archived.items.find((i) => i.id === a.id)?.archivedAt).not.toBeNull();
  });

  it('butuh login dan scope app; id tak dikenal 404; body salah 400', async () => {
    expect((await env.get('/conversations')).statusCode).toBe(401);
    const worker = (await env.loginOk({ kind: 'worker' })).accessToken;
    expect((await env.get('/conversations', worker)).statusCode).toBe(403);

    const missing = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';
    expect((await env.get(`/conversations/${missing}/messages`, token)).statusCode).toBe(404);
    expect((await env.del(`/conversations/${missing}`, token)).statusCode).toBe(404);
    expect((await env.post('/conversations', { surface: 'tv' }, token)).statusCode).toBe(400);
    expect(
      (await env.post('/conversations', { surface: 'windows', projectId: missing }, token))
        .statusCode,
    ).toBe(404);
  });
});

describe('kirim pesan dan run', () => {
  it('mengembalikan run segera, lalu jawaban mengalir dan tersimpan lengkap', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    hermes.onRequest(async (s) => {
      s.delta('Ha');
      await gate;
      s.delta('lo dunia');
      s.finish();
      s.usage(12, 5);
      s.done();
    });
    const conv = await createConversation();
    const { message, run } = await send(conv.id, 'Halo Hermes');

    // Hermes masih menahan jawaban, tetapi runId sudah ada.
    expect(message).toMatchObject({ author: 'user', runId: run.id, conversationId: conv.id });
    // Role diputuskan router pada status `routing`, jadi belum ada saat POST kembali.
    expect(run).toMatchObject({
      kind: 'chat',
      engine: 'hermes',
      agentRole: null,
      status: 'queued',
    });
    expect((await getRun(run.id)).status).not.toBe('completed');

    release();
    const done = await finalRun(run.id);
    expect(done).toMatchObject({
      status: 'completed',
      usage: { inputTokens: 12, outputTokens: 5 },
    });

    const events = await storedEvents(run.id);
    for (const e of events) expect(AgentEventSchema.safeParse(e).success).toBe(true);
    expect(events.filter((e) => e.type === 'run.status').map((e) => e.status)).toEqual([
      'queued',
      'routing',
      'preparing',
      'running',
      'completed',
    ]);
    expect(events.map((e) => e.type)).toEqual([
      'run.status',
      'run.status',
      'route.decided',
      'run.status',
      'run.status',
      'message.delta',
      'message.delta',
      'message.completed',
      'run.completed',
      'run.status',
    ]);
    expect(events.at(-1)).toEqual({ type: 'run.status', status: 'completed' });

    // Seq berurutan 1..n tanpa lubang.
    const rows = await env.database.handle.db
      .select({ seq: runEvents.seq })
      .from(runEvents)
      .where(eq(runEvents.runId, run.id))
      .orderBy(runEvents.seq);
    expect(rows.map((r) => r.seq)).toEqual(events.map((_, i) => i + 1));

    const history = (await env.get(`/conversations/${conv.id}/messages`, token)).json<{
      items: unknown[];
    }>();
    const parsed = history.items.map((m) => MessageSchema.parse(m));
    expect(parsed.map((m) => m.author)).toEqual(['user', 'assistant']);
    expect(parsed[1]).toMatchObject({
      parts: [{ type: 'text', text: 'Halo dunia' }],
      agentRole: 'general',
      runId: run.id,
    });
    expect(events.find((e) => e.type === 'message.delta')).toMatchObject({
      messageId: parsed[1]!.id,
    });
  });

  it('mengirim sesi Hermes yang sama untuk percakapan yang sama, dan menyimpannya per percakapan', async () => {
    answer('oke');
    const conv = await createConversation();
    const first = await send(conv.id, 'satu');
    await finalRun(first.run.id);
    const second = await send(conv.id, 'dua');
    await finalRun(second.run.id);

    const sessions = hermes.requests.map((r) => r.headers['x-hermes-session-id']);
    expect(sessions).toEqual([`aios-${conv.id}`, `aios-${conv.id}`]);
    expect(hermes.requests[1]!.body.messages.at(-1)).toEqual({ role: 'user', content: 'dua' });
    const [row] = await env.database.handle.db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conv.id));
    expect(row?.hermesSessionId).toBe(`aios-${conv.id}`);

    const other = await createConversation();
    await finalRun((await send(other.id, 'lain')).run.id);
    expect(hermes.requests[2]!.headers['x-hermes-session-id']).toBe(`aios-${other.id}`);
  });

  it('menolak pesan kedua selagi run masih berjalan (409), dan menerimanya setelah selesai', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    hermes.onRequest(async (s) => {
      s.delta('x');
      await gate;
      s.finish();
      s.done();
    });
    const conv = await createConversation();
    const { run } = await send(conv.id, 'pertama');
    const second = await env.post(
      `/conversations/${conv.id}/messages`,
      { parts: [{ type: 'text', text: 'kedua' }] },
      token,
    );
    expect([second.statusCode, problem(second).code]).toEqual([409, 'run_in_progress']);
    release();
    await finalRun(run.id);
    answer('lagi');
    const third = await send(conv.id, 'ketiga');
    expect((await finalRun(third.run.id)).status).toBe('completed');
  });

  it('validasi: lampiran, pesan kosong, role lain, percakapan diarsipkan, percakapan tak ada', async () => {
    const conv = await createConversation();
    const post = (body: object, id = conv.id) =>
      env.post(`/conversations/${id}/messages`, body, token);
    const file = await post({
      parts: [
        {
          type: 'file',
          fileId: '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f',
          name: 'a',
          mime: 'text/plain',
        },
      ],
    });
    expect([file.statusCode, problem(file).code]).toEqual([400, 'files_not_supported']);
    expect(problem(await post({ parts: [{ type: 'text', text: '   ' }] })).code).toBe(
      'empty_message',
    );
    expect((await post({ parts: [] })).statusCode).toBe(400);
    expect(
      problem(await post({ parts: [{ type: 'text', text: 'x' }], role: 'backend' })).code,
    ).toBe('role_not_allowed');
    expect(
      problem(await post({ parts: [{ type: 'text', text: 'x' }], role: 'tukang-sulap' })).code,
    ).toBe('unknown_role');
    await env.del(`/conversations/${conv.id}`, token);
    expect(problem(await post({ parts: [{ type: 'text', text: 'x' }] })).code).toBe(
      'conversation_archived',
    );
    expect(
      (await post({ parts: [{ type: 'text', text: 'x' }] }, '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f'))
        .statusCode,
    ).toBe(404);
    expect(hermes.requests).toHaveLength(0);
  });

  it('Hermes gagal: run failed dengan event error sebelum status akhir; pesan asisten tetap ada', async () => {
    hermes.onRequest((_s, _r, res) => {
      res.writeHead(429).end();
    });
    const conv = await createConversation();
    const { run } = await send(conv.id, 'halo');
    const done = await finalRun(run.id);
    expect(done.status).toBe('failed');
    expect(done.error).toEqual({
      code: 'hermes_busy',
      message: 'Hermes sedang penuh. Coba lagi sebentar.',
      retryable: true,
    });
    const events = await storedEvents(run.id);
    expect(events.slice(-2)).toEqual([
      {
        type: 'error',
        code: 'hermes_busy',
        message: expect.any(String) as string,
        retryable: true,
      },
      { type: 'run.status', status: 'failed' },
    ]);
    const history = (await env.get(`/conversations/${conv.id}/messages`, token)).json<{
      items: unknown[];
    }>();
    expect(history.items).toHaveLength(2);
  });

  it('jawaban terpotong di tengah: failed, teks sebagian tersimpan', async () => {
    hermes.onRequest((s) => {
      s.delta('Separuh');
      s.end();
    });
    const conv = await createConversation();
    const { run } = await send(conv.id, 'halo');
    expect((await finalRun(run.id)).error?.code).toBe('hermes_stream_truncated');
    const [assistant] = await env.database.handle.db
      .select()
      .from(messages)
      .where(eq(messages.runId, run.id))
      .orderBy(messages.id);
    const rows = await env.database.handle.db
      .select()
      .from(messages)
      .where(eq(messages.runId, run.id));
    expect(rows.find((m) => m.author === 'assistant')?.parts).toEqual([
      { type: 'text', text: 'Separuh' },
    ]);
    expect(assistant).toBeDefined();
  });
});

describe('cancel', () => {
  it('cancel di tengah stream: Hermes diputus, teks sebagian tersimpan, status akhir cancelled tanpa error', async () => {
    let closed!: Promise<void>;
    hermes.onRequest((s) => {
      closed = s.closed;
      s.delta('Awal ');
      s.delta('jawaban');
    });
    const conv = await createConversation();
    const { run } = await send(conv.id, 'cerita panjang');
    await until(
      async () => (await storedEvents(run.id)).filter((e) => e.type === 'message.delta').length,
      (n) => n === 2,
    );

    const res = await env.post(`/runs/${run.id}/cancel`, {}, token);
    expect(res.statusCode, res.body).toBe(200);
    expect(RunSchema.parse(res.json()).status).toBe('cancelled');
    await expect(
      Promise.race([
        closed,
        new Promise((_, rej) => setTimeout(() => rej(new Error('Hermes tidak diputus')), 15_000)),
      ]),
    ).resolves.toBeUndefined();

    const events = await storedEvents(run.id);
    expect(events.at(-1)).toEqual({ type: 'run.status', status: 'cancelled' });
    expect(events.map((e) => e.type)).not.toContain('error');
    expect(events.map((e) => e.type)).not.toContain('run.completed');
    const rows = await env.database.handle.db
      .select()
      .from(messages)
      .where(eq(messages.runId, run.id));
    expect(rows.find((m) => m.author === 'assistant')?.parts).toEqual([
      { type: 'text', text: 'Awal jawaban' },
    ]);

    const again = await env.post(`/runs/${run.id}/cancel`, {}, token);
    expect([again.statusCode, problem(again).code]).toEqual([409, 'run_not_active']);

    // Percakapan bisa dipakai lagi setelah cancel.
    answer('lanjut');
    await finalRun((await send(conv.id, 'lagi')).run.id);
  });

  it('cancel run yang tidak ada: 404', async () => {
    expect(
      (await env.post('/runs/0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f/cancel', {}, token)).statusCode,
    ).toBe(404);
  });
});

describe('putar ulang event lewat REST', () => {
  it('afterSeq dan limit memotong daftar; lastSeq menunjuk akhir halaman', async () => {
    answer('abcdef');
    const conv = await createConversation();
    const { run } = await send(conv.id, 'x');
    await finalRun(run.id);
    const all = RunEventsResponseSchema.parse(
      (await env.get(`/runs/${run.id}/events`, token)).json(),
    );
    expect(all.items.map((e) => e.seq)).toEqual(all.items.map((_, i) => i + 1));
    expect(all.lastSeq).toBe(all.items.length);

    const tail = RunEventsResponseSchema.parse(
      (await env.get(`/runs/${run.id}/events?afterSeq=5&limit=3`, token)).json(),
    );
    expect(tail.items.map((e) => e.seq)).toEqual([6, 7, 8]);
    expect(tail.lastSeq).toBe(8);
    const none = RunEventsResponseSchema.parse(
      (await env.get(`/runs/${run.id}/events?afterSeq=999`, token)).json(),
    );
    expect(none).toEqual({ items: [], lastSeq: 999 });
    expect((await env.get(`/runs/${run.id}/events?limit=0`, token)).statusCode).toBe(400);
  });
});

describe('judul otomatis', () => {
  // Hanya permintaan judul yang dijawab; permintaan router gagal (jatuh ke general) agar tidak ikut campur.
  const titleReply = (content: string) => (res: ServerResponse, body: string) => {
    if (!body.includes('Buat judul percakapan')) return void res.writeHead(500).end();
    res
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }));
  };
  const titleOf = async (id: string) =>
    (
      await until(
        async () =>
          ConversationSchema.parse(
            (await env.get('/conversations?limit=100', token))
              .json<{ items: unknown[] }>()
              .items.find((i) => (i as { id: string }).id === id),
          ),
        (c) => c.title !== '',
      )
    ).title;

  it('memakai model kecil, dipangkas maksimal 6 kata tanpa kutip dan titik akhir', async () => {
    routerReply = titleReply('"Rencana liburan keluarga ke Bali bulan depan yuk."\nCatatan lain');
    answer('ok');
    const conv = await createConversation();
    await send(conv.id, 'Tolong bantu aku merencanakan liburan keluarga ke Bali bulan depan');
    expect(await titleOf(conv.id)).toBe('Rencana liburan keluarga ke Bali bulan');
    expect(titleRequests()).toHaveLength(1);
  });

  it('9Router gagal: judul dari 6 kata pertama pesan; run tidak terganggu', async () => {
    answer('ok');
    const conv = await createConversation();
    const { run } = await send(conv.id, 'Satu dua tiga empat lima enam tujuh delapan');
    expect(await titleOf(conv.id)).toBe('Satu dua tiga empat lima enam');
    expect((await finalRun(run.id)).status).toBe('completed');
  });

  it('tidak menimpa judul yang sudah ada, dan hanya dibuat pada pesan pertama', async () => {
    routerReply = titleReply('Judul Model');
    answer('ok');
    const named = await createConversation({ surface: 'windows', title: 'Judul Saya' });
    const calls = titleRequests().length;
    await finalRun((await send(named.id, 'halo')).run.id);
    await env.chat.idle();
    expect(titleRequests().length).toBe(calls);
    const listed = (await env.get('/conversations?limit=100', token)).json<{
      items: { id: string; title: string }[];
    }>();
    expect(listed.items.find((i) => i.id === named.id)?.title).toBe('Judul Saya');

    const conv = await createConversation();
    await finalRun((await send(conv.id, 'pertama')).run.id);
    expect(await titleOf(conv.id)).toBe('Judul Model');
    const afterFirst = titleRequests().length;
    routerReply = titleReply('Judul Lain');
    await finalRun((await send(conv.id, 'kedua')).run.id);
    await env.chat.idle();
    expect(titleRequests().length).toBe(afterFirst);
  });
});

describe('pemulihan setelah gateway restart', () => {
  it('run yang tertinggal ditandai gagal; teks dari event delta dipulihkan ke pesan', async () => {
    const { db } = env.database.handle;
    const conv = await createConversation();
    const [run] = await db
      .insert(runs)
      .values({ kind: 'chat', engine: 'hermes', status: 'running', conversationId: conv.id })
      .returning();
    const [assistant] = await db
      .insert(messages)
      .values({
        conversationId: conv.id,
        author: 'assistant',
        parts: [{ type: 'text', text: '' }],
        runId: run!.id,
      })
      .returning();
    await env.store.append(run!.id, { type: 'run.status', status: 'running' });
    await env.store.append(run!.id, {
      type: 'message.delta',
      messageId: assistant!.id,
      text: 'Sebe',
    });
    await env.store.append(run!.id, {
      type: 'message.delta',
      messageId: assistant!.id,
      text: 'lum putus',
    });

    expect(await env.runner.recoverOrphans()).toBeGreaterThanOrEqual(1);

    const recovered = await getRun(run!.id);
    expect(recovered).toMatchObject({
      status: 'failed',
      error: { code: 'gateway_restarted', retryable: true },
    });
    const events = await storedEvents(run!.id);
    expect(events.slice(-2).map((e) => e.type)).toEqual(['error', 'run.status']);
    const [row] = await db.select().from(messages).where(eq(messages.id, assistant!.id));
    expect(row?.parts).toEqual([{ type: 'text', text: 'Sebelum putus' }]);
    expect(await env.runner.recoverOrphans()).toBe(0);
  });
});
