import http from 'node:http';
import net from 'node:net';
import type { Duplex } from 'node:stream';
import { BRIDGE_PATH, BRIDGE_SOURCE } from './bridge.js';

/** Sisip tag skrip tepat setelah `<head>` (atau di awal dokumen bila tidak ada). */
export function injectBridge(html: string): string {
  const tag = `<script src="${BRIDGE_PATH}"></script>`;
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (head) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + tag + html.slice(at);
  }
  return tag + html;
}

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

/**
 * Proxy balik ke dev server yang menyisipkan skrip jembatan ke halaman HTML. Tujuannya satu: halaman preview
 * di iframe aplikasi desktop (lintas origin) bisa melaporkan console dan melayani mode inspeksi lewat
 * postMessage. Hanya mendengarkan di loopback, hanya meneruskan ke satu tujuan tetap (dev server run ini),
 * dan meneruskan upgrade WebSocket (HMR).
 */
export class PreviewProxy {
  private server: http.Server | undefined;
  private readonly sockets = new Set<Duplex>();
  private port = 0;

  constructor(private readonly target: URL) {}

  get url(): string {
    return `http://127.0.0.1:${this.port}/`;
  }

  async start(): Promise<string> {
    const server = http.createServer((req, res) => this.handle(req, res));
    server.on('upgrade', (req, socket, head) => this.upgrade(req, socket, head));
    server.on('connection', (socket) => {
      this.sockets.add(socket);
      socket.once('close', () => this.sockets.delete(socket));
    });
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('proxy preview gagal mendengarkan');
    this.port = address.port;
    return this.url;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (req.url === BRIDGE_PATH) {
      res.writeHead(200, {
        'content-type': 'text/javascript; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(BRIDGE_SOURCE);
      return;
    }
    const headers: http.OutgoingHttpHeaders = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (HOP_BY_HOP.has(name) || name === 'accept-encoding') continue;
      headers[name] = value;
    }
    // Dev server memeriksa Host/Origin (mis. allowedHosts); tampil seperti klien langsung.
    headers.host = this.target.host;
    if (typeof headers.origin === 'string') headers.origin = this.target.origin;

    const upstream = http.request(
      {
        host: this.target.hostname.replace(/^\[|\]$/g, ''),
        port: this.target.port,
        method: req.method,
        path: req.url,
        headers,
      },
      (response) => {
        const out: http.OutgoingHttpHeaders = {};
        for (const [name, value] of Object.entries(response.headers)) {
          if (HOP_BY_HOP.has(name)) continue;
          // Halaman dibuka dalam iframe aplikasi: larangan framing dari dev server dibuang.
          if (name === 'x-frame-options') continue;
          out[name] = value;
        }
        const location = response.headers.location;
        if (typeof location === 'string' && location.startsWith(this.target.origin)) {
          out.location = location.slice(this.target.origin.length) || '/';
        }
        const type = String(response.headers['content-type'] ?? '');
        if (!type.includes('text/html')) {
          res.writeHead(response.statusCode ?? 502, out);
          response.pipe(res);
          return;
        }
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          const body = Buffer.from(injectBridge(Buffer.concat(chunks).toString('utf8')), 'utf8');
          delete out['content-length'];
          delete out['content-encoding'];
          out['content-length'] = body.length;
          res.writeHead(response.statusCode ?? 502, out);
          res.end(body);
        });
      },
    );
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Dev server tidak terjangkau.');
    });
    req.pipe(upstream);
  }

  private upgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): void {
    const upstream = net.connect(
      Number(this.target.port),
      this.target.hostname.replace(/^\[|\]$/g, ''),
      () => {
        const lines = [`${req.method ?? 'GET'} ${req.url ?? '/'} HTTP/1.1`];
        for (let i = 0; i < req.rawHeaders.length; i += 2) {
          const name = req.rawHeaders[i] ?? '';
          let value = req.rawHeaders[i + 1] ?? '';
          if (name.toLowerCase() === 'host') value = this.target.host;
          if (name.toLowerCase() === 'origin') value = this.target.origin;
          lines.push(`${name}: ${value}`);
        }
        upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
        if (head.length > 0) upstream.write(head);
        upstream.pipe(socket);
        socket.pipe(upstream);
      },
    );
    this.sockets.add(upstream);
    upstream.once('close', () => {
      this.sockets.delete(upstream);
      socket.destroy();
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
  }
}
