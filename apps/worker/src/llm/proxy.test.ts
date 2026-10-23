import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LlmProxy } from './proxy.js';

interface Seen {
  method: string | undefined;
  url: string | undefined;
  headers: IncomingMessage['headers'];
  body: string;
}

let upstream: Server;
let upstreamUrl: string;
let seen: Seen[];
let handler: (req: IncomingMessage, res: ServerResponse, body: string) => void;
let proxy: LlmProxy;
let base: string;
const token = vi.fn<(options?: { force?: boolean }) => Promise<string | null>>();
let serverUrl: string | null;

beforeEach(async () => {
  seen = [];
  handler = (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  };
  upstream = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      handler(req, res, body);
    });
  });
  await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
  upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  serverUrl = upstreamUrl;
  token.mockReset();
  token.mockResolvedValue('token-perangkat-1');
  proxy = new LlmProxy({ serverUrl: () => serverUrl, token });
  base = `http://127.0.0.1:${await proxy.start()}`;
});
afterEach(async () => {
  await proxy.close();
  upstream.closeAllConnections();
  await new Promise<void>((r) => upstream.close(() => r()));
});

const call = (path: string, init: RequestInit & { key?: string | null } = {}) => {
  const { key = proxy.key, ...rest } = init;
  return fetch(`${base}${path}`, {
    method: 'POST',
    ...rest,
    headers: {
      'content-type': 'application/json',
      ...(key ? { authorization: `Bearer ${key}` } : {}),
    },
  });
};

describe('LlmProxy', () => {
  it('meneruskan ke <gateway>/llm/v1 dengan token perangkat; kunci lokal tidak bocor ke gateway', async () => {
    const res = await call('/v1/chat/completions?x=1', { body: '{"model":"m","stream":true}' });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      method: 'POST',
      url: '/llm/v1/chat/completions?x=1',
      body: '{"model":"m","stream":true}',
    });
    expect(seen[0]?.headers.authorization).toBe('Bearer token-perangkat-1');
    expect(JSON.stringify(seen[0]?.headers)).not.toContain(proxy.key);
  });

  it('respons SSE mengalir bertahap, bukan menunggu seluruh isi', async () => {
    let finish: () => void = () => undefined;
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: satu\n\n');
      finish = () => {
        res.write('data: dua\n\n');
        res.end();
      };
    };
    const res = await call('/v1/chat/completions', { body: '{}' });
    const reader = res.body!.getReader();

    const first = new TextDecoder().decode((await reader.read()).value as Uint8Array);
    expect(first).toBe('data: satu\n\n');
    finish();
    const second = new TextDecoder().decode((await reader.read()).value as Uint8Array);
    expect(second).toBe('data: dua\n\n');
    expect(res.headers.get('content-type')).toBe('text/event-stream');
  });

  it('tanpa kunci atau dengan kunci salah ditolak 401 dan tidak menyentuh gateway', async () => {
    expect((await call('/v1/chat/completions', { key: null, body: '{}' })).status).toBe(401);
    expect((await call('/v1/chat/completions', { key: 'salah', body: '{}' })).status).toBe(401);
    expect(seen).toEqual([]);
    expect(token).not.toHaveBeenCalled();
  });

  it('hanya /v1/*: path lain dan traversal ditolak 404', async () => {
    expect((await call('/admin', { body: '{}' })).status).toBe(404);
    expect((await call('/v1/../auth/login', { body: '{}' })).status).toBe(404);
    expect(seen).toEqual([]);
  });

  it('belum ada sesi: 503 jelas', async () => {
    serverUrl = null;
    expect((await call('/v1/models', { method: 'GET' })).status).toBe(503);

    serverUrl = upstreamUrl;
    token.mockResolvedValue(null);
    expect((await call('/v1/models', { method: 'GET' })).status).toBe(503);
  });

  it('gateway menolak token (401): refresh dipaksa, lalu dicoba sekali lagi dengan token baru', async () => {
    token.mockImplementation((options) =>
      Promise.resolve(options?.force ? 'token-baru' : 'token-lama'),
    );
    handler = (req, res) => {
      res.writeHead(req.headers.authorization === 'Bearer token-baru' ? 200 : 401, {
        'content-type': 'application/json',
      });
      res.end('{}');
    };

    const res = await call('/v1/chat/completions', { body: '{"a":1}' });

    expect(res.status).toBe(200);
    expect(seen.map((s) => s.headers.authorization)).toEqual([
      'Bearer token-lama',
      'Bearer token-baru',
    ]);
    expect(seen[1]?.body).toBe('{"a":1}');
  });

  it('status galat dari gateway diteruskan apa adanya (mis. 429)', async () => {
    handler = (_req, res) => {
      res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '7' });
      res.end('{"error":"terlalu banyak"}');
    };

    const res = await call('/v1/chat/completions', { body: '{}' });

    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('7');
  });

  it('gateway tidak terjangkau: 502', async () => {
    serverUrl = 'http://127.0.0.1:9';

    expect((await call('/v1/chat/completions', { body: '{}' })).status).toBe(502);
  });

  it('klien membatalkan di tengah stream: permintaan ke gateway ikut dibatalkan', async () => {
    let upstreamClosed = false;
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: awal\n\n');
      res.on('close', () => {
        upstreamClosed = true;
      });
    };
    const controller = new AbortController();
    const res = await call('/v1/chat/completions', { body: '{}', signal: controller.signal });
    await res.body!.getReader().read();

    controller.abort();

    await vi.waitFor(() => expect(upstreamClosed).toBe(true));
  });

  it('kunci lokal berbeda di setiap instans', () => {
    const other = new LlmProxy({ serverUrl: () => null, token });
    expect(other.key).not.toBe(proxy.key);
    expect(proxy.key).toHaveLength(48);
  });
});
