import { SearchResponseSchema } from '@aios/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { conversations, messages, researchJobs } from '../../db/schema/index.js';
import { createAuthEnv, type AuthEnv } from '../../testing/auth-env.js';
import { searchQuery } from './service.js';

let env: AuthEnv;
let token: string;

beforeAll(async () => {
  env = await createAuthEnv(inject('testDatabaseUrl'));
  token = (await env.loginOk({ kind: 'desktop' })).accessToken;
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  const db = env.database.handle.db;
  await db.delete(messages);
  await db.delete(conversations);
  await db.delete(researchJobs);
});

const db = () => env.database.handle.db;
const search = async (q: string) => {
  const res = await env.get(`/search?q=${encodeURIComponent(q)}`, token);
  expect(res.statusCode, res.body).toBe(200);
  return SearchResponseSchema.parse(res.json()).items;
};

async function conversationWith(title: string, texts: string[], archived = false) {
  const [conv] = await db()
    .insert(conversations)
    .values({ title, surface: 'windows', ...(archived ? { archivedAt: new Date() } : {}) })
    .returning();
  for (const text of texts) {
    await db()
      .insert(messages)
      .values({ conversationId: conv!.id, author: 'user', parts: [{ type: 'text', text }] });
  }
  return conv!;
}

describe('searchQuery', () => {
  it('semua kata kunci (AND) dengan awalan; kata umum dibuang', () => {
    expect(searchQuery('backup database harian')).toBe('backup:* & database:* & harian:*');
    expect(searchQuery('apa itu')).toBeNull();
  });
});

describe('GET /search', () => {
  it('menemukan pesan dan riset yang memuat semua kata, dengan cuplikan dan judul', async () => {
    const backup = await conversationWith('Backup VPS', [
      'Bagaimana cara menjadwalkan backup database Postgres setiap malam?',
      'Pakai cron dan pg_dump.',
    ]);
    await conversationWith('Resep', ['Resep rendang padang']);
    await db().insert(researchJobs).values({
      question: 'Strategi backup database untuk VPS kecil',
      status: 'completed',
      reportMd: 'Laporan: gunakan pg_dump terkompresi dan simpan di object storage.',
    });

    const items = await search('backup database');
    expect(items.map((i) => i.kind).sort()).toEqual(['message', 'research']);
    const message = items.find((i) => i.kind === 'message');
    expect(message).toMatchObject({ conversationId: backup.id, title: 'Backup VPS' });
    expect(message?.snippet).toContain('backup database');

    // Awalan: "datab" cocok dengan "database"; kata yang tidak ada membuat hasil kosong (AND).
    expect((await search('datab postgres')).length).toBe(1);
    expect(await search('backup kucing')).toEqual([]);
  });

  it('percakapan diarsipkan tidak ikut; pesan berlampiran tanpa teks diabaikan', async () => {
    await conversationWith('Lama', ['Catatan rahasia proyek elang'], true);
    expect(await search('proyek elang')).toEqual([]);
  });

  it('validasi: kurang dari 2 karakter 400; tanpa token 401; tanda baca tsquery aman', async () => {
    expect((await env.get('/search?q=a', token)).statusCode).toBe(400);
    expect((await env.get('/search?q=backup')).statusCode).toBe(401);
    const res = await env.get(`/search?q=${encodeURIComponent("x' & | ! (")}`, token);
    expect(res.statusCode).toBe(200);
  });
});
