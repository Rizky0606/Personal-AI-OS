import {
  ConversationSchema,
  MessageSchema,
  ProblemSchema,
  RunSchema,
  SendMessageResponseSchema,
} from '@aios/contracts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createAuthEnv, type AuthEnv } from '../../testing/auth-env.js';
import { startFakeHermes, type FakeHermes } from '../../testing/fake-hermes.js';
import { startMockServer, type MockServer } from '../../testing/mock-server.js';
import { HANDOFF_PREFIX, HANDOFF_SYSTEM_PROMPT, MAX_MESSAGE_CHARS } from './service.js';

let router: MockServer;
let hermes: FakeHermes;
let env: AuthEnv;
let token: string;
const bodies: { model: string; messages: { role: string; content: string }[] }[] = [];
let reply: () => { status: number; body: unknown } = () => ({ status: 200, body: {} });

const json = (res: ServerResponse, status: number, body: unknown) =>
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));

function answer(req: IncomingMessage, res: ServerResponse) {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    bodies.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as (typeof bodies)[number]);
    const out = reply();
    json(res, out.status, out.body);
  });
}
const completion = (content: string) => ({
  status: 200,
  body: { choices: [{ message: { role: 'assistant', content } }] },
});

beforeAll(async () => {
  router = await startMockServer(answer);
  hermes = await startFakeHermes();
  env = await createAuthEnv(inject('testDatabaseUrl'), {
    ninerouterUrl: `${router.url}/v1`,
    hermesUrl: hermes.url,
  });
  token = (await env.loginOk({ kind: 'desktop' })).accessToken;
  hermes.onRequest((s) => {
    s.delta('Siap.');
    s.finish();
    s.done();
  });
});
afterAll(async () => {
  await env.close();
  await hermes.close();
  await router.close();
});

async function conversationWith(title: string, turns: [string, string][]) {
  const conv = ConversationSchema.parse(
    (await env.post('/conversations', { surface: 'windows' }, token)).json(),
  );
  const db = env.database.handle.db;
  const { conversations, messages } = await import('../../db/schema/index.js');
  const { eq } = await import('drizzle-orm');
  await db.update(conversations).set({ title }).where(eq(conversations.id, conv.id));
  for (const [user, assistant] of turns) {
    await db
      .insert(messages)
      .values({ conversationId: conv.id, author: 'user', parts: [{ type: 'text', text: user }] });
    await db.insert(messages).values({
      conversationId: conv.id,
      author: 'assistant',
      parts: [{ type: 'text', text: assistant }],
    });
  }
  return conv;
}

const handoff = (id: string, body: object = { model: 'peringkas' }) =>
  env.post(`/conversations/${id}/handoff`, body, token);
const messagesOf = async (id: string) =>
  z
    .array(MessageSchema)
    .parse(
      (await env.get(`/conversations/${id}/messages`, token)).json<{ items: unknown[] }>().items,
    );

describe('POST /conversations/:id/handoff', () => {
  it('meringkas percakapan lalu membuka percakapan baru berisi ringkasan sebagai pesan sistem', async () => {
    bodies.length = 0;
    reply = () => completion('- Tujuan: bangun toko online.\n- Belum: pembayaran.');
    const source = await conversationWith('Toko online', [
      ['Buat katalog produk', 'Katalog dibuat.'],
      ['Tambah keranjang', 'Keranjang ditambahkan.'],
    ]);

    const res = await handoff(source.id);
    expect(res.statusCode, res.body).toBe(201);
    const created = ConversationSchema.parse(res.json());
    expect(created.id).not.toBe(source.id);
    expect(created.title).toBe('Lanjutan: Toko online');

    // Model peninjau menerima transkrip kronologis dan aturan ringkasan.
    expect(bodies[0]).toMatchObject({ model: 'peringkas' });
    expect(bodies[0]?.messages[0]).toEqual({ role: 'system', content: HANDOFF_SYSTEM_PROMPT });
    expect(bodies[0]?.messages[1]?.content).toBe(
      [
        'Pemilik: Buat katalog produk',
        'Asisten: Katalog dibuat.',
        'Pemilik: Tambah keranjang',
        'Asisten: Keranjang ditambahkan.',
      ].join('\n\n'),
    );

    const seeded = await messagesOf(created.id);
    expect(seeded).toHaveLength(1);
    expect(seeded[0]).toMatchObject({ author: 'system' });
    expect(JSON.stringify(seeded[0]?.parts)).toContain(HANDOFF_PREFIX);
    expect(JSON.stringify(seeded[0]?.parts)).toContain('Belum: pembayaran.');
    // Percakapan lama tidak berubah.
    expect(await messagesOf(source.id)).toHaveLength(4);
  });

  it('pesan pertama di percakapan baru membawa ringkasan sebagai riwayat awal ke agent', async () => {
    reply = () => completion('Ringkasan: pelanggan minta diskon 10%.');
    const source = await conversationWith('Diskon', [['Beri diskon 10%', 'Siap, 10%.']]);
    const created = ConversationSchema.parse((await handoff(source.id)).json());

    hermes.requests.length = 0;
    const sent = SendMessageResponseSchema.parse(
      (
        await env.post(
          `/conversations/${created.id}/messages`,
          { parts: [{ type: 'text', text: 'Lanjutkan pekerjaan tadi' }], role: 'general' },
          token,
        )
      ).json(),
    );
    const deadline = Date.now() + 20_000;
    for (;;) {
      const run = RunSchema.parse((await env.get(`/runs/${sent.run.id}`, token)).json());
      if (run.status === 'completed' || Date.now() > deadline) break;
      await new Promise((r) => setTimeout(r, 20));
    }

    const sentMessages = hermes.requests.at(-1)?.body.messages ?? [];
    const contents = sentMessages.map((m) => `${m.role}:${String(m.content)}`);
    expect(contents.some((c) => c.startsWith('user:' + HANDOFF_PREFIX))).toBe(true);
    expect(contents.join('\n')).toContain('pelanggan minta diskon 10%');
    expect(contents.at(-1)).toContain('Lanjutkan pekerjaan tadi');
  });

  it('pesan panjang dipotong sebelum diringkas', async () => {
    bodies.length = 0;
    reply = () => completion('ok');
    const source = await conversationWith('Panjang', [['x'.repeat(MAX_MESSAGE_CHARS + 500), 'y']]);
    await handoff(source.id);
    expect(bodies[0]?.messages[1]?.content).toBe(
      `Pemilik: ${'x'.repeat(MAX_MESSAGE_CHARS)}\n\nAsisten: y`,
    );
  });

  it('percakapan kosong 409; tidak ada 404; model gagal 502; permintaan tak sah 400; tanpa token 401', async () => {
    const empty = ConversationSchema.parse(
      (await env.post('/conversations', { surface: 'windows' }, token)).json(),
    );
    const res = await handoff(empty.id);
    expect(res.statusCode).toBe(409);
    expect(ProblemSchema.parse(res.json()).code).toBe('conversation_empty');

    expect((await handoff('0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f')).statusCode).toBe(404);

    const source = await conversationWith('Gagal', [['a', 'b']]);
    reply = () => ({ status: 500, body: { error: { message: 'provider mati' } } });
    const failed = await handoff(source.id);
    expect(failed.statusCode).toBe(502);
    expect(ProblemSchema.parse(failed.json()).code).toBe('handoff_failed');
    reply = () => completion('   ');
    expect((await handoff(source.id)).statusCode).toBe(502);

    expect((await handoff(source.id, {})).statusCode).toBe(400);
    expect((await env.post(`/conversations/${source.id}/handoff`, { model: 'm' })).statusCode).toBe(
      401,
    );
  });
});
