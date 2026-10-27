import { ConversationSchema, RunSchema, SendMessageResponseSchema } from '@aios/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createAuthEnv, type AuthEnv } from '../../testing/auth-env.js';
import { startFakeHermes, type FakeHermes } from '../../testing/fake-hermes.js';
import { createLinkReader } from './links.js';

const ARTICLE = `<!doctype html><html><head><title>Roadmap Produk</title></head><body><article><h1>Roadmap Produk</h1>${'<p>Tahun depan kami menambahkan mode gelap, ekspor PDF, dan integrasi kalender untuk semua pengguna.</p>'.repeat(6)}</article></body></html>`;

let hermes: FakeHermes;
let env: AuthEnv;
let token: string;
const fetched: string[] = [];
const searched: { text: string; history: number }[] = [];

beforeAll(async () => {
  hermes = await startFakeHermes();
  env = await createAuthEnv(inject('testDatabaseUrl'), {
    hermesUrl: hermes.url,
    web: {
      contextFor: (text, history = []) => {
        searched.push({ text, history: history.length });
        return Promise.resolve(
          '# Hasil pencarian web\n\n## [1] https://berita.dev/gpu — Harga GPU',
        );
      },
    },
    links: createLinkReader({
      fetchPage: (url) => {
        fetched.push(url);
        return url.includes('rusak')
          ? Promise.reject(new Error('Halaman menjawab HTTP 404.'))
          : Promise.resolve({
              finalUrl: url,
              contentType: 'text/html',
              html: ARTICLE,
              truncated: false,
            });
      },
    }),
  });
  token = (await env.loginOk({ kind: 'desktop' })).accessToken;
  hermes.onRequest((s) => {
    s.delta('Sudah saya baca.');
    s.finish();
    s.done();
  });
});
afterAll(async () => {
  await env.close();
  await hermes.close();
});

async function ask(text: string, webSearch?: boolean): Promise<string> {
  const conv = ConversationSchema.parse(
    (await env.post('/conversations', { surface: 'windows' }, token)).json(),
  );
  hermes.requests.length = 0;
  const sent = SendMessageResponseSchema.parse(
    (
      await env.post(
        `/conversations/${conv.id}/messages`,
        { parts: [{ type: 'text', text }], role: 'general', ...(webSearch ? { webSearch } : {}) },
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
  const user = hermes.requests
    .at(-1)
    ?.body.messages.filter((m) => m.role === 'user')
    .at(-1);
  return String(user?.content ?? '');
}

describe('tautan di pesan chat', () => {
  it('isi halaman ditempel ke prompt agent, pesan tersimpan tetap hanya teks pemilik', async () => {
    fetched.length = 0;
    const prompt = await ask('Ringkas https://contoh.dev/roadmap untuk saya');
    expect(fetched).toEqual(['https://contoh.dev/roadmap']);
    expect(prompt).toContain('Ringkas https://contoh.dev/roadmap untuk saya');
    expect(prompt).toContain('# Isi tautan di pesan');
    expect(prompt).toContain('## https://contoh.dev/roadmap — Roadmap Produk');
    expect(prompt).toContain('mode gelap, ekspor PDF');
  });

  it('tautan yang gagal dibuka dicatat; pesan tetap terkirim', async () => {
    const prompt = await ask('Cek https://rusak.dev/x');
    expect(prompt).toContain('(gagal dibuka: Halaman menjawab HTTP 404.)');
  });

  it('tanpa tautan: tidak ada yang diambil dan prompt tidak berubah', async () => {
    fetched.length = 0;
    const prompt = await ask('Halo, apa kabar?');
    expect(fetched).toEqual([]);
    expect(prompt).toBe('Halo, apa kabar?');
  });
});

describe('pencarian web di pesan chat', () => {
  it('webSearch: hasil pencarian ditempel ke prompt dengan pesan dan riwayat sebagai bahan kueri', async () => {
    searched.length = 0;
    const prompt = await ask('Berapa harga GPU sekarang?', true);
    expect(searched).toEqual([{ text: 'Berapa harga GPU sekarang?', history: 0 }]);
    expect(prompt).toContain('Berapa harga GPU sekarang?');
    expect(prompt).toContain('# Hasil pencarian web');
    expect(prompt).toContain('## [1] https://berita.dev/gpu');
  });

  it('tanpa webSearch tidak ada pencarian', async () => {
    searched.length = 0;
    const prompt = await ask('Berapa harga GPU sekarang?');
    expect(searched).toEqual([]);
    expect(prompt).toBe('Berapa harga GPU sekarang?');
  });
});
