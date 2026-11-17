import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GatewayToolsRelay } from './relay.js';

const RUN_A = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';
const RUN_B = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8ea0';

interface Seen {
  method: string | undefined;
  url: string | undefined;
  headers: IncomingMessage['headers'];
  body: string;
}

let upstream: Server;
let seen: Seen[];
let handler: (req: IncomingMessage, res: ServerResponse) => void;
let relay: GatewayToolsRelay;
let serverUrl: string | null;
const token = vi.fn<(options?: { force?: boolean }) => Promise<string | null>>();

beforeEach(async () => {
  seen = [];
  handler = (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"jsonrpc":"2.0","id":1,"result":{}}');
  };
  upstream = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      handler(req, res);
    });
  });
  await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
  serverUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  token.mockReset();
  token.mockResolvedValue('token-perangkat-1');
  relay = new GatewayToolsRelay({ serverUrl: () => serverUrl, token });
});
afterEach(async () => {
  await relay.close();
  upstream.closeAllConnections();
  await new Promise<void>((r) => upstream.close(() => r()));
});

const ping = '{"jsonrpc":"2.0","id":1,"method":"ping"}';

describe('GatewayToolsRelay', () => {
  it('meneruskan ke <gateway>/v1/mcp dengan token perangkat dan run id pendaftaran; token lokal tidak bocor', async () => {
    const reg = await relay.register(RUN_A);
    const res = await fetch(reg.url, {
      method: 'POST',
      headers: {
        ...reg.headers,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-11-25',
        // omp tidak bisa memilih run lain lewat header.
        'x-aios-run-id': RUN_B,
        cookie: 'sesi=rahasia',
      },
      body: ping,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
    expect(reg.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp\//);
    expect(seen).toHaveLength(1);
    const [first] = seen;
    expect(first).toMatchObject({ method: 'POST', url: '/v1/mcp', body: ping });
    expect(first?.headers.authorization).toBe('Bearer token-perangkat-1');
    expect(first?.headers['x-aios-run-id']).toBe(RUN_A);
    expect(first?.headers['mcp-protocol-version']).toBe('2025-11-25');
    expect(first?.headers.cookie).toBeUndefined();
    const localToken = reg.headers.Authorization?.slice('Bearer '.length) ?? '';
    expect(localToken).toHaveLength(48);
    expect(JSON.stringify(first?.headers)).not.toContain(localToken);
  });

  it('token lokal salah, token run lain, atau run yang sudah dilepas ditolak 401 tanpa menyentuh gateway', async () => {
    const a = await relay.register(RUN_A);
    const b = await relay.register(RUN_B);
    const post = (url: string, headers: Record<string, string>) =>
      fetch(url, { method: 'POST', headers, body: ping });

    expect((await post(a.url, {})).status).toBe(401);
    expect((await post(a.url, { Authorization: 'Bearer salah' })).status).toBe(401);
    expect((await post(a.url, b.headers)).status).toBe(401);
    a.unregister();
    expect((await post(a.url, a.headers)).status).toBe(401);
    expect((await post(b.url, b.headers)).status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.headers['x-aios-run-id']).toBe(RUN_B);
  });

  it('401 dari gateway: satu kali coba lagi dengan token yang dipaksa segar', async () => {
    const reg = await relay.register(RUN_A);
    token.mockResolvedValueOnce('token-lama').mockResolvedValueOnce('token-baru');
    handler = (req, res) => {
      const fresh = req.headers.authorization === 'Bearer token-baru';
      res.writeHead(fresh ? 200 : 401, { 'content-type': 'application/json' });
      res.end(fresh ? '{"jsonrpc":"2.0","id":1,"result":{}}' : '{"code":"token_expired"}');
    };
    const res = await fetch(reg.url, { method: 'POST', headers: reg.headers, body: ping });
    expect(res.status).toBe(200);
    expect(token).toHaveBeenLastCalledWith({ force: true });
    expect(seen.map((s) => s.headers.authorization)).toEqual([
      'Bearer token-lama',
      'Bearer token-baru',
    ]);
  });

  it('jawaban gateway diteruskan apa adanya (202 notifikasi, 409 run selesai); GET 405 dan DELETE 204 dijawab lokal', async () => {
    const reg = await relay.register(RUN_A);
    handler = (_req, res) => {
      res.writeHead(202);
      res.end();
    };
    const note = await fetch(reg.url, {
      method: 'POST',
      headers: reg.headers,
      body: '{"jsonrpc":"2.0","method":"notifications/initialized"}',
    });
    expect(note.status).toBe(202);
    expect(await note.text()).toBe('');

    handler = (_req, res) => {
      res.writeHead(409, { 'content-type': 'application/problem+json' });
      res.end('{"code":"run_not_active"}');
    };
    const done = await fetch(reg.url, { method: 'POST', headers: reg.headers, body: ping });
    expect(done.status).toBe(409);
    expect(await done.json()).toEqual({ code: 'run_not_active' });

    const before = seen.length;
    expect((await fetch(reg.url, { headers: reg.headers })).status).toBe(405);
    expect((await fetch(reg.url, { method: 'DELETE', headers: reg.headers })).status).toBe(204);
    expect(seen).toHaveLength(before);
  });

  it('tanpa sesi gateway 503; isi di atas 256 KiB 413', async () => {
    const reg = await relay.register(RUN_A);
    serverUrl = null;
    expect(
      (await fetch(reg.url, { method: 'POST', headers: reg.headers, body: ping })).status,
    ).toBe(503);
    serverUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
    const big = await fetch(reg.url, {
      method: 'POST',
      headers: reg.headers,
      body: 'x'.repeat(300 * 1024),
    });
    expect(big.status).toBe(413);
    expect(seen).toHaveLength(0);
  });

  it('konektor: diteruskan ke /v1/mcp/connector/<id>; token jalur lain ditolak 401; unregister melepas satu jalur saja', async () => {
    const tools = await relay.register(RUN_A);
    const github = await relay.registerConnector(RUN_A, 'kon-1');
    const linear = await relay.registerConnector(RUN_A, 'kon-2');
    const post = (url: string, headers: Record<string, string>) =>
      fetch(url, { method: 'POST', headers, body: ping });

    expect(github.url).toMatch(/\/mcp\/[^/]+\/konektor\/kon-1$/);
    expect((await post(github.url, github.headers)).status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: 'POST', url: '/v1/mcp/connector/kon-1', body: ping });
    expect(seen[0]?.headers['x-aios-run-id']).toBe(RUN_A);
    expect(seen[0]?.headers.authorization).toBe('Bearer token-perangkat-1');

    // Token satu jalur tidak berlaku di jalur lain, meski run-nya sama.
    expect((await post(github.url, tools.headers)).status).toBe(401);
    expect((await post(github.url, linear.headers)).status).toBe(401);
    expect((await post(tools.url, github.headers)).status).toBe(401);
    // Konektor run lain memakai jalur lain: tokennya tidak bisa dipindah.
    const lain = await relay.registerConnector(RUN_B, 'kon-1');
    expect((await post(github.url, lain.headers)).status).toBe(401);
    expect(seen).toHaveLength(1);

    // GET dan DELETE tetap dijawab lokal untuk jalur konektor.
    expect((await fetch(github.url, { headers: github.headers })).status).toBe(405);
    expect((await fetch(github.url, { method: 'DELETE', headers: github.headers })).status).toBe(
      204,
    );

    github.unregister();
    expect((await post(github.url, github.headers)).status).toBe(401);
    expect((await post(linear.url, linear.headers)).status).toBe(200);
    expect((await post(tools.url, tools.headers)).status).toBe(200);
    expect(seen.map((s) => s.url)).toEqual([
      '/v1/mcp/connector/kon-1',
      '/v1/mcp/connector/kon-2',
      '/v1/mcp',
    ]);
  });
});
