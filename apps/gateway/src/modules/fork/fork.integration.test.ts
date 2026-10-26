import {
  ConversationSchema,
  MessageSchema,
  ProblemSchema,
  RunSchema,
  SendMessageResponseSchema,
} from '@aios/contracts';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { conversations, messages, runs } from '../../db/schema/index.js';
import { createAuthEnv, type AuthEnv } from '../../testing/auth-env.js';
import { startFakeHermes, type FakeHermes } from '../../testing/fake-hermes.js';
import { MAX_FORK_MESSAGES } from './service.js';

let hermes: FakeHermes;
let env: AuthEnv;
let token: string;

beforeAll(async () => {
  hermes = await startFakeHermes();
  env = await createAuthEnv(inject('testDatabaseUrl'), { hermesUrl: hermes.url });
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
});

const db = () => env.database.handle.db;

/** Percakapan berisi pasangan (pengguna, asisten) berurutan; mengembalikan percakapan dan ID pesannya. */
async function conversationWith(title: string, turns: [string, string][]) {
  const conv = ConversationSchema.parse(
    (await env.post('/conversations', { surface: 'windows' }, token)).json(),
  );
  await db().update(conversations).set({ title }).where(eq(conversations.id, conv.id));
  const ids: string[] = [];
  for (const [user, assistant] of turns) {
    for (const [author, text] of [
      ['user', user],
      ['assistant', assistant],
    ] as const) {
      const [row] = await db()
        .insert(messages)
        .values({
          conversationId: conv.id,
          author,
          parts: [{ type: 'text', text }],
          ...(author === 'assistant' ? { agentRole: 'general', model: 'm1' } : {}),
        })
        .returning({ id: messages.id });
      ids.push(row!.id);
    }
  }
  return { conv, ids };
}

const fork = (messageId: string) => env.post(`/messages/${messageId}/fork`, {}, token);
const messagesOf = async (id: string) =>
  z
    .array(MessageSchema)
    .parse(
      (await env.get(`/conversations/${id}/messages`, token)).json<{ items: unknown[] }>().items,
    );
const texts = (items: { parts: { type: string; text?: string }[] }[]) =>
  items.map((m) => m.parts.map((p) => p.text ?? '').join(''));

describe('POST /messages/:id/fork', () => {
  it('menyalin pesan sampai pesan itu ke percakapan baru; asal tidak berubah', async () => {
    const { conv, ids } = await conversationWith('Toko', [
      ['Buat katalog', 'Katalog dibuat.'],
      ['Tambah keranjang', 'Keranjang ditambahkan.'],
    ]);

    const res = await fork(ids[1]!);
    expect(res.statusCode, res.body).toBe(201);
    const created = ConversationSchema.parse(res.json());
    expect(created).toMatchObject({ title: 'Cabang: Toko', surface: 'windows' });
    expect(created.id).not.toBe(conv.id);

    const copied = await messagesOf(created.id);
    expect(texts(copied)).toEqual(['Buat katalog', 'Katalog dibuat.']);
    expect(copied.map((m) => m.author)).toEqual(['user', 'assistant']);
    expect(copied[1]).toMatchObject({ agentRole: 'general', model: 'm1', runId: null });
    expect(copied.every((m) => m.conversationId === created.id)).toBe(true);
    expect(ids).not.toContain(copied[0]?.id);

    expect(texts(await messagesOf(conv.id))).toEqual([
      'Buat katalog',
      'Katalog dibuat.',
      'Tambah keranjang',
      'Keranjang ditambahkan.',
    ]);
  });

  it('cabang dari pesan terakhir menyalin semuanya; pesan pertama di cabang membawa salinan sebagai riwayat awal', async () => {
    const { ids } = await conversationWith('Diskon', [
      ['Beri diskon 10%', 'Siap, 10%.'],
      ['Ubah jadi 15%', 'Diubah jadi 15%.'],
    ]);
    const created = ConversationSchema.parse((await fork(ids[1]!)).json());

    hermes.requests.length = 0;
    const sent = SendMessageResponseSchema.parse(
      (
        await env.post(
          `/conversations/${created.id}/messages`,
          { parts: [{ type: 'text', text: 'Coba 20% saja' }], role: 'general' },
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

    const body = (hermes.requests.at(-1)?.body.messages ?? [])
      .filter((m) => m.role !== 'system')
      .map((m) => `${m.role}:${String(m.content)}`);
    expect(body).toEqual(['user:Beri diskon 10%', 'assistant:Siap, 10%.', 'user:Coba 20% saja']);
    // Jalur asli tidak menyimpan pesan "Coba 20% saja".
    expect((await messagesOf(created.id)).length).toBe(4);
  });

  it('pesan sistem tidak bisa dicabangkan (409); tidak ada 404; tanpa token 401', async () => {
    const { conv } = await conversationWith('Sistem', [['a', 'b']]);
    const [system] = await db()
      .insert(messages)
      .values({
        conversationId: conv.id,
        author: 'system',
        parts: [{ type: 'text', text: 'catatan' }],
      })
      .returning({ id: messages.id });
    const res = await fork(system!.id);
    expect(res.statusCode).toBe(409);
    expect(ProblemSchema.parse(res.json()).code).toBe('message_not_forkable');

    expect((await fork('0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f')).statusCode).toBe(404);
    expect((await env.post(`/messages/${system!.id}/fork`, {})).statusCode).toBe(401);
  });

  it('jawaban yang run-nya masih berjalan belum bisa dicabangkan (409 run_active)', async () => {
    const { conv, ids } = await conversationWith('Berjalan', [['a', 'b']]);
    const [run] = await db()
      .insert(runs)
      .values({ kind: 'chat', engine: 'hermes', status: 'running', conversationId: conv.id })
      .returning({ id: runs.id });
    await db().update(messages).set({ runId: run!.id }).where(eq(messages.id, ids[1]!));

    const res = await fork(ids[1]!);
    expect(res.statusCode).toBe(409);
    expect(ProblemSchema.parse(res.json()).code).toBe('run_active');
    // Pesan pengguna sebelum jawaban itu tetap bisa dijadikan titik cabang.
    expect((await fork(ids[0]!)).statusCode).toBe(201);
  });

  it(`riwayat lebih dari ${MAX_FORK_MESSAGES} pesan ditolak jelas`, async () => {
    const conv = ConversationSchema.parse(
      (await env.post('/conversations', { surface: 'windows' }, token)).json(),
    );
    const rows = await db()
      .insert(messages)
      .values(
        Array.from({ length: MAX_FORK_MESSAGES + 1 }, () => ({
          conversationId: conv.id,
          author: 'user' as const,
          parts: [{ type: 'text' as const, text: 'x' }],
        })),
      )
      .returning({ id: messages.id });
    const last = rows
      .map((r) => r.id)
      .sort()
      .at(-1)!;
    const res = await fork(last);
    expect(res.statusCode).toBe(409);
    expect(ProblemSchema.parse(res.json()).code).toBe('fork_too_long');
  });
});
