import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ConnectorError, createConnectorClient } from './client.js';

/**
 * Klien MCP diuji terhadap server HTTP sungguhan di loopback (bukan `fetch` tiruan): yang perlu dibuktikan
 * justru perilaku transport — SSE, sesi, redirect, batas ukuran — bukan bentuk objeknya.
 */

interface FakeOptions {
  /** Menjawab `text/event-stream` alih-alih JSON. */
  sse?: boolean;
  /** Mengirim `Mcp-Session-Id` saat initialize dan mewajibkannya di permintaan berikutnya. */
  session?: string;
  /** Token yang wajib ada di `Authorization`. */
  token?: string;
  /** Mengalihkan permintaan pertama ke lokasi ini. */
  redirectTo?: string;
  /** Jawaban `tools/call` sebesar ini (byte) untuk menguji batas ukuran. */
  hugeBytes?: number;
}

interface Fake {
  url: string;
  server: Server;
  calls: { method: string; sessionId?: string | undefined; auth?: string | undefined }[];
  /** Sesi yang "hilang" setelah dipakai sekali (menguji handshake ulang). */
  expireNextCall: () => void;
}

function startFake(options: FakeOptions = {}): Promise<Fake> {
  const calls: Fake['calls'] = [];
  let expire = false;
  let redirected = false;
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      if (options.redirectTo && !redirected) {
        redirected = true;
        res.writeHead(307, { location: options.redirectTo });
        res.end();
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req as AsyncIterable<Buffer>) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as {
        id?: number;
        method?: string;
      };
      const sessionHeader = req.headers['mcp-session-id'];
      calls.push({
        method: body.method ?? '',
        sessionId: typeof sessionHeader === 'string' ? sessionHeader : undefined,
        auth: req.headers.authorization,
      });
      if (options.token && req.headers.authorization !== `Bearer ${options.token}`) {
        res.writeHead(401).end();
        return;
      }
      if (body.method === 'notifications/initialized') {
        res.writeHead(202).end();
        return;
      }
      if (options.session && body.method !== 'initialize' && sessionHeader !== options.session) {
        res.writeHead(404).end();
        return;
      }
      if (expire && body.method === 'tools/call') {
        expire = false;
        res.writeHead(404).end();
        return;
      }
      const result =
        body.method === 'initialize'
          ? {
              protocolVersion: '2025-03-26',
              capabilities: { tools: {} },
              serverInfo: { name: 'server-palsu', version: '9.9' },
            }
          : body.method === 'tools/list'
            ? {
                tools: [
                  {
                    name: 'cari',
                    description: 'baca',
                    inputSchema: { type: 'object' },
                    annotations: { readOnlyHint: true },
                  },
                  { name: 'tulis', description: 'tulis', inputSchema: { type: 'object' } },
                ],
              }
            : {
                content: [
                  {
                    type: 'text',
                    text: options.hugeBytes ? 'x'.repeat(options.hugeBytes) : 'hasil',
                  },
                ],
              };
      const payload = JSON.stringify({ jsonrpc: '2.0', id: body.id, result });
      const headers: Record<string, string> = {
        'content-type': options.sse ? 'text/event-stream' : 'application/json',
      };
      if (options.session && body.method === 'initialize')
        headers['mcp-session-id'] = options.session;
      res.writeHead(200, headers);
      res.end(options.sse ? `event: message\ndata: ${payload}\n\n` : payload);
    })();
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}/mcp`,
        server,
        calls,
        expireNextCall: () => {
          expire = true;
        },
      });
    });
  });
}

const open: Server[] = [];
afterEach(async () => {
  while (open.length > 0) {
    const server = open.pop();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function fake(options: FakeOptions = {}): Promise<Fake> {
  const started = await startFake(options);
  open.push(started.server);
  return started;
}

const client = () => createConnectorClient({ allowPrivateHosts: true });

describe('klien MCP konektor', () => {
  it('initialize + tools/list membaca nama server dan readOnlyHint', async () => {
    const server = await fake();
    const { session, tools, truncated } = await client().probe({ url: server.url });
    expect(session.serverName).toBe('server-palsu');
    expect(session.protocolVersion).toBe('2025-03-26');
    expect(truncated).toBe(false);
    expect(tools.map((t) => [t.name, t.readOnly])).toEqual([
      ['cari', true],
      // Hint yang hilang dianggap menulis.
      ['tulis', false],
    ]);
    expect(server.calls.map((c) => c.method)).toEqual([
      'initialize',
      'notifications/initialized',
      'tools/list',
    ]);
  });

  it('membaca jawaban text/event-stream', async () => {
    const server = await fake({ sse: true });
    const { tools } = await client().probe({ url: server.url });
    expect(tools).toHaveLength(2);
  });

  it('mengirim token hanya lewat header Authorization', async () => {
    const server = await fake({ token: 'rahasia-konektor' });
    await client().probe({ url: server.url, token: 'rahasia-konektor' });
    expect(server.calls.every((c) => c.auth === 'Bearer rahasia-konektor')).toBe(true);
    await expect(client().probe({ url: server.url, token: 'salah' })).rejects.toThrow(
      /menolak token/,
    );
  });

  it('memakai ulang Mcp-Session-Id dan handshake ulang sekali bila sesi hilang', async () => {
    const server = await fake({ session: 'sesi-1' });
    const mcp = client();
    await mcp.callTool('k1', { url: server.url }, 'cari', {});
    expect(server.calls.at(-1)?.sessionId).toBe('sesi-1');
    const before = server.calls.length;
    server.expireNextCall();
    const result = await mcp.callTool('k1', { url: server.url }, 'cari', {});
    expect(result.isError).toBe(false);
    // tools/call gagal, initialize ulang, notifications, tools/call berhasil.
    expect(server.calls.slice(before).map((c) => c.method)).toEqual([
      'tools/call',
      'initialize',
      'notifications/initialized',
      'tools/call',
    ]);
  });

  it('mengikuti redirect di origin yang sama, menolak yang keluar', async () => {
    const target = await fake();
    const sameOrigin = await fake({ redirectTo: '/mcp2' });
    await expect(client().probe({ url: sameOrigin.url })).resolves.toBeTruthy();

    const keluar = await fake({ redirectTo: target.url });
    await expect(client().probe({ url: keluar.url })).rejects.toThrow(/host lain/);
  });

  it('memotong jawaban yang terlalu besar', async () => {
    const server = await fake({ hugeBytes: 5000 });
    const kecil = createConnectorClient({ allowPrivateHosts: true, maxBytes: 1000 });
    await expect(kecil.callTool('k1', { url: server.url }, 'cari', {})).rejects.toBeInstanceOf(
      ConnectorError,
    );
  });

  it('menolak URL yang melanggar aturan sebelum koneksi dibuka', async () => {
    const ketat = createConnectorClient();
    await expect(ketat.probe({ url: 'http://127.0.0.1:1/mcp' })).rejects.toThrow(
      /URL konektor harus https/,
    );
    await expect(ketat.probe({ url: 'https://127.0.0.1/mcp' })).rejects.toThrow(/jaringan privat/);
  });
});
