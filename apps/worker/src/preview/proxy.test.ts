import http from 'node:http';
import vm from 'node:vm';
import type { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BRIDGE_PATH, BRIDGE_SOURCE } from './bridge.js';
import { PreviewProxy, injectBridge } from './proxy.js';

describe('injectBridge', () => {
  it('menyisipkan skrip setelah <head>, atau di awal bila tidak ada head', () => {
    const tag = `<script src="${BRIDGE_PATH}"></script>`;
    expect(injectBridge('<html><head><title>x</title></head></html>')).toBe(
      `<html><head>${tag}<title>x</title></head></html>`,
    );
    expect(injectBridge('<HEAD data-a="1"><meta></HEAD>')).toBe(
      `<HEAD data-a="1">${tag}<meta></HEAD>`,
    );
    expect(injectBridge('<p>halo</p>')).toBe(`${tag}<p>halo</p>`);
  });
});

describe('BRIDGE_SOURCE', () => {
  it('JavaScript yang valid, tanpa backtick (disimpan sebagai string)', () => {
    expect(() => new vm.Script(BRIDGE_SOURCE)).not.toThrow();
    expect(BRIDGE_SOURCE).not.toContain('`');
  });
});

describe('PreviewProxy', () => {
  let upstream: http.Server;
  let sockets: WebSocketServer;
  let proxy: PreviewProxy;
  let proxyUrl: string;
  let seenHost: string | undefined;

  beforeEach(async () => {
    upstream = http.createServer((req, res) => {
      seenHost = req.headers.host;
      if (req.url === '/') {
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'x-frame-options': 'DENY',
        });
        res.end('<html><head></head><body>Beranda</body></html>');
      } else if (req.url === '/data.json') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
      } else if (req.url === '/lama') {
        res.writeHead(302, {
          location: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/`,
        });
        res.end();
      } else {
        res.writeHead(404).end();
      }
    });
    sockets = new WebSocketServer({ server: upstream });
    sockets.on('connection', (ws) =>
      ws.on('message', (m) => ws.send(`gema:${(m as Buffer).toString()}`)),
    );
    await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
    const port = (upstream.address() as AddressInfo).port;
    proxy = new PreviewProxy(new URL(`http://127.0.0.1:${port}/`));
    proxyUrl = await proxy.start();
  });
  afterEach(async () => {
    await proxy.stop();
    sockets.close();
    await new Promise((r) => upstream.close(r));
  });

  it('halaman HTML disisipi skrip jembatan; header framing dibuang', async () => {
    const res = await fetch(proxyUrl);
    const html = await res.text();
    expect(html).toContain(`<script src="${BRIDGE_PATH}"></script>`);
    expect(html).toContain('Beranda');
    expect(res.headers.get('x-frame-options')).toBeNull();
    expect(Number(res.headers.get('content-length'))).toBe(Buffer.byteLength(html));
  });

  it('skrip jembatan disajikan proxy; respons non-HTML diteruskan apa adanya', async () => {
    const bridge = await (await fetch(new URL(BRIDGE_PATH, proxyUrl))).text();
    expect(bridge).toBe(BRIDGE_SOURCE);
    expect(await (await fetch(new URL('/data.json', proxyUrl))).json()).toEqual({ ok: true });
    expect((await fetch(new URL('/tidak-ada', proxyUrl))).status).toBe(404);
  });

  it('Host ditulis ulang ke dev server; redirect ke dev server menjadi relatif ke proxy', async () => {
    const res = await fetch(new URL('/lama', proxyUrl), { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/');
    expect(seenHost).toBe(
      new URL(`http://127.0.0.1:${(upstream.address() as AddressInfo).port}/`).host,
    );
  });

  it('WebSocket (HMR) diteruskan dua arah', async () => {
    const ws = new WebSocket(proxyUrl.replace('http', 'ws'));
    const reply = await new Promise<string>((resolve, reject) => {
      ws.on('open', () => ws.send('halo'));
      ws.on('message', (m) => resolve((m as Buffer).toString()));
      ws.on('error', reject);
    });
    ws.close();
    expect(reply).toBe('gema:halo');
  });

  it('dev server mati: 502 dengan pesan yang jelas', async () => {
    const dead = new PreviewProxy(new URL('http://127.0.0.1:1/'));
    const url = await dead.start();
    const res = await fetch(url);
    expect(res.status).toBe(502);
    expect(await res.text()).toContain('tidak terjangkau');
    await dead.stop();
  });
});
