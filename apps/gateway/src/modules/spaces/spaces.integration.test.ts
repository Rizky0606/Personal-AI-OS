import {
  ConversationSchema,
  FileRecordSchema,
  ProblemSchema,
  RunSchema,
  SendMessageResponseSchema,
  SpaceDocumentListSchema,
  SpaceDocumentSchema,
  SpaceListSchema,
  SpaceSchema,
} from '@aios/contracts';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { conversations, spaceChunks, spaces } from '../../db/schema/index.js';
import { createAuthEnv, type AuthEnv } from '../../testing/auth-env.js';
import { startFakeHermes, type FakeHermes } from '../../testing/fake-hermes.js';

let env: AuthEnv;
let hermes: FakeHermes;
let token: string;

beforeAll(async () => {
  hermes = await startFakeHermes();
  env = await createAuthEnv(inject('testDatabaseUrl'), { hermesUrl: hermes.url });
  token = (await env.loginOk({ kind: 'desktop' })).accessToken;
  hermes.onRequest((s) => {
    s.delta('Menurut [1], dendanya 2% per hari.');
    s.finish();
    s.done();
  });
});
afterAll(async () => {
  await env.close();
  await hermes.close();
});
beforeEach(async () => {
  hermes.requests.length = 0;
  await env.database.handle.db.delete(spaces);
});

const problem = (res: { json(): unknown }) => ProblemSchema.parse(res.json());
const patch = (url: string, payload: object) =>
  env.app.inject({
    method: 'PATCH',
    url: `/v1${url}`,
    payload,
    headers: { authorization: `Bearer ${token}` },
  });

async function upload(name: string, text: string | Buffer, mime = 'text/plain') {
  const form = new FormData();
  form.append('file', new Blob([text], { type: mime }), name);
  const body = new Response(form);
  const res = await env.app.inject({
    method: 'POST',
    url: '/v1/files',
    headers: {
      'content-type': body.headers.get('content-type')!,
      authorization: `Bearer ${token}`,
    },
    payload: Buffer.from(await body.arrayBuffer()),
  });
  expect(res.statusCode, res.body).toBe(201);
  return FileRecordSchema.parse(res.json());
}

const createSpace = async (name = 'Kontrak kerja') => {
  const res = await env.post('/spaces', { name, description: 'Dokumen kontrak' }, token);
  expect(res.statusCode, res.body).toBe(201);
  return SpaceSchema.parse(res.json());
};
const addDoc = async (spaceId: string, fileId: string) => {
  const res = await env.post(`/spaces/${spaceId}/documents`, { fileId }, token);
  expect(res.statusCode, res.body).toBe(201);
  return SpaceDocumentSchema.parse(res.json());
};

const CONTRACT = [
  'Pasal 1. Para pihak sepakat bekerja sama dalam pembuatan aplikasi.',
  '',
  'Pasal 7. Keterlambatan pembayaran dikenakan denda sebesar 2% per hari dari nilai tagihan.',
  '',
  'Pasal 9. Perjanjian berakhir pada 31 Desember 2027.',
].join('\n');

/** Pesan pertama di percakapan ruang; mengembalikan prompt pengguna yang diterima Hermes. */
async function askInSpace(spaceId: string, question: string) {
  const conv = ConversationSchema.parse(
    (await env.post('/conversations', { surface: 'windows', spaceId }, token)).json(),
  );
  expect(conv.spaceId).toBe(spaceId);
  const sent = SendMessageResponseSchema.parse(
    (
      await env.post(
        `/conversations/${conv.id}/messages`,
        { parts: [{ type: 'text', text: question }] },
        token,
      )
    ).json(),
  );
  const deadline = Date.now() + 30_000;
  for (;;) {
    const run = RunSchema.parse((await env.get(`/runs/${sent.run.id}`, token)).json());
    if (['completed', 'failed', 'cancelled'].includes(run.status) || Date.now() > deadline) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  const user = hermes.requests
    .at(-1)
    ?.body.messages.filter((m) => m.role === 'user')
    .at(-1);
  return { conversationId: conv.id, prompt: String(user?.content ?? '') };
}

describe('ruang: CRUD dan dokumen', () => {
  it('buat, ubah, daftar dengan jumlah dokumen, hapus', async () => {
    const space = await createSpace();
    expect(space).toMatchObject({ name: 'Kontrak kerja', documentCount: 0 });
    const updated = await patch(`/spaces/${space.id}`, { name: 'Kontrak 2026' });
    expect(SpaceSchema.parse(updated.json()).name).toBe('Kontrak 2026');

    const file = await upload('kontrak.txt', CONTRACT);
    const doc = await addDoc(space.id, file.id);
    expect(doc).toMatchObject({ name: 'kontrak.txt', chars: CONTRACT.length });
    expect(doc.chunks).toBeGreaterThan(0);

    const list = SpaceListSchema.parse((await env.get('/spaces', token)).json()).items;
    expect(list.map((s) => [s.id, s.documentCount])).toEqual([[space.id, 1]]);

    expect((await env.del(`/spaces/${space.id}`, token)).statusCode).toBe(204);
    expect(await env.database.handle.db.select().from(spaceChunks)).toEqual([]);
  });

  it('dokumen ganda 409, gambar ditolak, dokumen dikeluarkan, ruang tidak ada 404', async () => {
    const space = await createSpace();
    const file = await upload('kontrak.txt', CONTRACT);
    const doc = await addDoc(space.id, file.id);

    const dup = await env.post(`/spaces/${space.id}/documents`, { fileId: file.id }, token);
    expect(dup.statusCode).toBe(409);
    expect(problem(dup).code).toBe('space_document_exists');

    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );
    const image = await upload('foto.png', png, 'image/png');
    const rejected = await env.post(`/spaces/${space.id}/documents`, { fileId: image.id }, token);
    expect(rejected.statusCode).toBe(400);
    expect(problem(rejected).code).toBe('space_document_unsupported');

    expect((await env.del(`/spaces/${space.id}/documents/${doc.id}`, token)).statusCode).toBe(204);
    const docs = SpaceDocumentListSchema.parse(
      (await env.get(`/spaces/${space.id}/documents`, token)).json(),
    ).items;
    expect(docs).toEqual([]);

    const missing = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';
    expect((await env.get(`/spaces/${missing}/documents`, token)).statusCode).toBe(404);
    const conv = await env.post('/conversations', { surface: 'windows', spaceId: missing }, token);
    expect(conv.statusCode).toBe(404);
    expect(problem(conv).code).toBe('space_not_found');
  });
});

describe('ruang: chat memakai dokumen sebagai sumber', () => {
  it('potongan yang relevan dikirim ke agent bernomor; pesan pengguna tetap pertanyaan saja', async () => {
    const space = await createSpace();
    await addDoc(space.id, (await upload('kontrak.txt', CONTRACT)).id);

    const { conversationId, prompt } = await askInSpace(
      space.id,
      'Berapa denda keterlambatan pembayaran?',
    );
    expect(prompt).toContain('Berapa denda keterlambatan pembayaran?');
    expect(prompt).toContain('# Sumber dari ruang "Kontrak kerja"');
    expect(prompt).toContain('[1] kontrak.txt');
    expect(prompt).toContain('denda sebesar 2% per hari');
    expect(prompt).toContain('Sumber:');

    const listed = await env.get(`/conversations?spaceId=${space.id}`, token);
    expect(listed.json<{ items: { id: string }[] }>().items.map((c) => c.id)).toEqual([
      conversationId,
    ]);
    const messages = await env.get(`/conversations/${conversationId}/messages`, token);
    expect(JSON.stringify(messages.json())).not.toContain('# Sumber dari ruang');
  });

  it('pertanyaan yang tidak cocok dengan dokumen: agent diminta jujur tidak menemukan', async () => {
    const space = await createSpace();
    await addDoc(space.id, (await upload('kontrak.txt', CONTRACT)).id);
    const { prompt } = await askInSpace(space.id, 'Resep rendang padang yang enak');
    expect(prompt).toContain('Tidak ada bagian dokumen yang cocok');
  });

  it('ruang dihapus: percakapannya tetap ada tanpa ruang', async () => {
    const space = await createSpace();
    const { conversationId } = await askInSpace(space.id, 'Kapan perjanjian berakhir?');
    expect((await env.del(`/spaces/${space.id}`, token)).statusCode).toBe(204);
    const [row] = await env.database.handle.db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId));
    expect(row?.spaceId).toBeNull();
  });
});
