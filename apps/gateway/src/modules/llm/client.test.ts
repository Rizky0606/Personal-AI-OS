import { describe, expect, it } from 'vitest';
import { AppError } from '../../errors.js';
import { startMockServer } from '../../testing/mock-server.js';
import { createNineRouterClient } from './client.js';
import { createModelsService, friendlyLabel } from './models.js';
import { SseUsageTap, mergeUsage, parseUsage, usageFromPayload } from './usage.js';

const fast = { retryDelayMs: 0 };
const failure = async (p: Promise<unknown>): Promise<AppError> => {
  try {
    await p;
  } catch (err) {
    if (err instanceof AppError) return err;
    throw err;
  }
  throw new Error('seharusnya gagal');
};

describe('klien 9Router', () => {
  it('mengirim API key gateway dan memakai path relatif terhadap NINEROUTER_URL', async () => {
    const server = await startMockServer((_req, res) => res.end('{}'));
    const client = createNineRouterClient({ baseUrl: `${server.url}/v1`, apiKey: 'sk-gateway' });
    await (await client.request('/models?x=1')).text();
    expect(server.requests).toEqual([
      { method: 'GET', url: '/v1/models?x=1', authorization: 'Bearer sk-gateway' },
    ]);
    await server.close();
  });

  it('mengulang 502/503 lalu berhasil; tidak mengulang 4xx atau 504', async () => {
    let n = 0;
    const flaky = await startMockServer((_req, res) => {
      res.writeHead(n++ < 2 ? 503 : 200).end('{}');
    });
    const client = createNineRouterClient({ baseUrl: `${flaky.url}/v1`, ...fast });
    expect((await client.request('/models')).status).toBe(200);
    expect(flaky.requests).toHaveLength(3);
    await flaky.close();

    for (const status of [400, 404, 504]) {
      const once = await startMockServer((_req, res) => res.writeHead(status).end());
      const c = createNineRouterClient({ baseUrl: `${once.url}/v1`, ...fast });
      expect((await c.request('/x')).status).toBe(status);
      expect(once.requests).toHaveLength(1);
      await once.close();
    }
  });

  it('menyerah setelah batas retry dan mengembalikan respons sementara terakhir', async () => {
    const down = await startMockServer((_req, res) => res.writeHead(503).end());
    const client = createNineRouterClient({ baseUrl: `${down.url}/v1`, retries: 1, ...fast });
    expect((await client.request('/models')).status).toBe(503);
    expect(down.requests).toHaveLength(2);
    await down.close();
  });

  it('koneksi ditolak: 502 llm_upstream_unreachable setelah retry, tanpa membocorkan alamat', async () => {
    const dead = await startMockServer(() => undefined);
    const url = dead.url;
    await dead.close();
    const err = await failure(
      createNineRouterClient({ baseUrl: `${url}/v1`, ...fast }).request('/models'),
    );
    expect([err.status, err.code]).toEqual([502, 'llm_upstream_unreachable']);
    expect(err.message).not.toContain(url);
  });

  it('header respons tidak datang tepat waktu: 504 tanpa retry', async () => {
    const slow = await startMockServer(() => undefined);
    const client = createNineRouterClient({ baseUrl: `${slow.url}/v1`, timeoutMs: 50, ...fast });
    const err = await failure(client.request('/chat/completions', { method: 'POST', body: '{}' }));
    expect([err.status, err.code]).toEqual([504, 'llm_upstream_timeout']);
    expect(slow.requests).toHaveLength(1);
    await slow.close();
  });

  it('pembatalan dari pemanggil diteruskan apa adanya, tidak diubah jadi 502/504', async () => {
    const hang = await startMockServer(() => undefined);
    const client = createNineRouterClient({ baseUrl: `${hang.url}/v1`, ...fast });
    const abort = new AbortController();
    const pending = client.request('/x', { signal: abort.signal });
    setTimeout(() => abort.abort(), 20);
    await expect(pending).rejects.not.toBeInstanceOf(AppError);
    await hang.close();
  });

  it('menolak path yang keluar dari NINEROUTER_URL', async () => {
    const server = await startMockServer((_req, res) => res.end('{}'));
    const client = createNineRouterClient({ baseUrl: `${server.url}/v1` });
    for (const path of ['/../api/keys', '/%2e%2e/api/keys', '/a/../../api/keys']) {
      expect((await failure(client.request(path))).code, path).toBe('invalid_llm_path');
    }
    expect(server.requests).toHaveLength(0);
    await server.close();
  });
});

describe('daftar model', () => {
  const upstream = (body: unknown = { data: [] }) =>
    startMockServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    });
  const sample = {
    object: 'list',
    data: [
      { id: 'aisubs/gpt-6-sol', object: 'model', owned_by: 'aisubs' },
      { id: 'router-fast', object: 'model', owned_by: 'combo' },
      { id: 'coding-main', object: 'model', owned_by: 'combo' },
      { id: 'tanpa-pemilik' },
    ],
  };

  it('label ramah, combo di depan, urut menurut id', () => {
    expect(friendlyLabel('coding-main', 'combo')).toBe('Coding Main');
    expect(friendlyLabel('aisubs/gpt-6-sol', 'model')).toBe('gpt-6-sol (aisubs)');
    expect(friendlyLabel('mentah', 'model')).toBe('mentah');
  });

  it('memetakan respons OpenAI ke ModelInfo', async () => {
    const server = await upstream(sample);
    const client = createNineRouterClient({ baseUrl: `${server.url}/v1`, ...fast });
    expect(await createModelsService({ client }).list()).toEqual([
      { id: 'coding-main', label: 'Coding Main', kind: 'combo', ownedBy: 'combo' },
      { id: 'router-fast', label: 'Router Fast', kind: 'combo', ownedBy: 'combo' },
      { id: 'aisubs/gpt-6-sol', label: 'gpt-6-sol (aisubs)', kind: 'model', ownedBy: 'aisubs' },
      { id: 'tanpa-pemilik', label: 'tanpa-pemilik', kind: 'model', ownedBy: 'unknown' },
    ]);
    await server.close();
  });

  it('di-cache 5 menit, lalu diambil ulang; request bersamaan berbagi satu panggilan', async () => {
    const server = await upstream(sample);
    const client = createNineRouterClient({ baseUrl: `${server.url}/v1`, ...fast });
    const clock = { now: 1_000_000 };
    const models = createModelsService({ client, now: () => clock.now });

    await Promise.all([models.list(), models.list(), models.list()]);
    expect(server.requests).toHaveLength(1);
    clock.now += 5 * 60_000 - 1;
    await models.list();
    expect(server.requests).toHaveLength(1);
    clock.now += 1;
    await models.list();
    expect(server.requests).toHaveLength(2);
    await server.close();
  });

  it('memakai cache lama saat 9Router gangguan; tanpa cache jadi 502', async () => {
    let healthy = true;
    const server = await startMockServer((_req, res) => {
      if (!healthy) return void res.writeHead(500).end();
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(sample));
    });
    const client = createNineRouterClient({ baseUrl: `${server.url}/v1`, retries: 0, ...fast });
    const clock = { now: 0 };
    const warnings: string[] = [];
    const models = createModelsService({
      client,
      now: () => clock.now,
      log: { warn: (_obj, msg) => warnings.push(msg) },
    });

    healthy = false;
    expect((await failure(models.list())).code).toBe('llm_upstream_error');
    healthy = true;
    const fresh = await models.list();
    healthy = false;
    clock.now += 10 * 60_000;
    expect(await models.list()).toEqual(fresh);
    expect(warnings).toHaveLength(1);
    await server.close();
  });

  it('daftar yang bentuknya tidak dikenali: 502', async () => {
    const server = await upstream({ models: [] });
    const client = createNineRouterClient({ baseUrl: `${server.url}/v1`, ...fast });
    expect((await failure(createModelsService({ client }).list())).code).toBe('llm_upstream_error');
    await server.close();
  });
});

describe('membaca usage', () => {
  it('gaya OpenAI, termasuk token reasoning dan cached', () => {
    expect(
      parseUsage({
        prompt_tokens: 12,
        completion_tokens: 30,
        prompt_tokens_details: { cached_tokens: 4 },
        completion_tokens_details: { reasoning_tokens: 9 },
      }),
    ).toEqual({ inputTokens: 12, outputTokens: 30, reasoningTokens: 9, cachedTokens: 4 });
  });

  it('gaya Anthropic dan Responses, termasuk yang bersarang di message/response', () => {
    expect(parseUsage({ input_tokens: 5, output_tokens: 6 })).toEqual({
      inputTokens: 5,
      outputTokens: 6,
    });
    expect(
      usageFromPayload({ response: { usage: { input_tokens: 1, output_tokens: 2 } } }),
    ).toEqual({ inputTokens: 1, outputTokens: 2 });
    expect(usageFromPayload({ message: { usage: { input_tokens: 7, output_tokens: 1 } } })).toEqual(
      { inputTokens: 7, outputTokens: 1 },
    );
  });

  it('mengabaikan nilai tidak masuk akal dan usage kosong', () => {
    expect(parseUsage(null)).toBeNull();
    expect(parseUsage({ prompt_tokens: -3, completion_tokens: 'banyak' })).toBeNull();
    expect(usageFromPayload({ choices: [] })).toBeNull();
  });

  it('menggabungkan laporan parsial dengan nilai terbesar per field', () => {
    expect(
      mergeUsage({ inputTokens: 10, outputTokens: 1 }, { inputTokens: 0, outputTokens: 40 }),
    ).toEqual({ inputTokens: 10, outputTokens: 40 });
  });

  it('SseUsageTap meneruskan byte apa adanya meski baris data terpotong antar-chunk', async () => {
    const lines =
      'data: {"choices":[{"delta":{"content":"a"}}]}\n\n' +
      'data: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":4}}\n\n' +
      'data: [DONE]\n\n';
    let seen: unknown = 'belum';
    const tap = new SseUsageTap((u) => (seen = u));
    const out: Buffer[] = [];
    tap.on('data', (c: Buffer) => out.push(c));
    const done = new Promise((resolve) => tap.on('end', resolve));
    for (let i = 0; i < lines.length; i += 7) tap.write(lines.slice(i, i + 7));
    tap.end();
    await done;
    expect(Buffer.concat(out).toString()).toBe(lines);
    expect(seen).toEqual({ inputTokens: 3, outputTokens: 4 });
  });
});
