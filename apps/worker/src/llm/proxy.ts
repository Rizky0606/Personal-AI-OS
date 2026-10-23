import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';

export interface LlmProxyDeps {
  /** Alamat gateway (https://host); null bila belum ada sesi. */
  serverUrl: () => string | null;
  /** Access token worker yang berlaku; `force` memaksa refresh setelah gateway menolak token. */
  token: (options?: { force?: boolean }) => Promise<string | null>;
  fetch?: typeof fetch;
  log?: (message: string) => void;
}

const MAX_BODY_BYTES = 16 * 1024 * 1024;
const PASS_REQUEST_HEADERS = ['content-type', 'accept', 'openai-organization', 'openai-beta'];
const PASS_RESPONSE_HEADERS = ['content-type', 'cache-control', 'x-request-id', 'retry-after'];

/**
 * Proxy HTTP lokal untuk LLM: omp bicara ke `127.0.0.1:<port>/v1` dengan kunci lokal acak, proxy
 * meneruskan ke `<gateway>/llm/v1` dengan token perangkat worker yang selalu segar. Hasilnya: token perangkat
 * tidak pernah masuk lingkungan atau berkas konfigurasi omp, dan run lebih dari 15 menit tidak putus
 * karena access token habis. Hanya path `/v1/...`; kunci lokal diperiksa dengan perbandingan waktu-konstan.
 */
export class LlmProxy {
  /** Kunci yang dipakai omp; berganti di setiap start worker. */
  readonly key = randomBytes(24).toString('hex');
  private readonly server: Server;

  constructor(private readonly deps: LlmProxyDeps) {
    this.server = createServer((req, res) => void this.handle(req, res));
  }

  async start(): Promise<number> {
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', resolve);
    });
    return (this.server.address() as AddressInfo).port;
  }

  async close(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private authorized(req: IncomingMessage): boolean {
    const header = req.headers.authorization ?? '';
    const given = /^Bearer (.+)$/i.exec(header)?.[1] ?? '';
    const a = Buffer.from(given);
    const b = Buffer.from(this.key);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const reply = (status: number, code: string, message: string) => {
      if (res.headersSent) {
        res.end();
        return;
      }
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code, message } }));
    };
    if (!this.authorized(req)) return reply(401, 'invalid_api_key', 'Kunci lokal tidak valid.');
    const url = req.url ?? '';
    if (!url.startsWith('/v1/') || url.includes('..')) {
      return reply(404, 'not_found', 'Hanya /v1/* yang diteruskan.');
    }
    const base = this.deps.serverUrl();
    if (!base) return reply(503, 'no_session', 'Worker belum tersambung ke gateway.');

    let body: Buffer;
    try {
      body = await readBody(req);
    } catch {
      return reply(413, 'too_large', 'Isi permintaan terlalu besar.');
    }

    const aborter = new AbortController();
    res.on('close', () => aborter.abort());
    const send = async (token: string) =>
      (this.deps.fetch ?? fetch)(`${base}/llm${url}`, {
        method: req.method ?? 'POST',
        headers: {
          ...pick(req.headers, PASS_REQUEST_HEADERS),
          authorization: `Bearer ${token}`,
        },
        ...(body.length > 0 && req.method !== 'GET' ? { body: new Uint8Array(body) } : {}),
        signal: aborter.signal,
      });

    try {
      let token = await this.deps.token();
      if (!token)
        return reply(503, 'no_session', 'Sesi worker tidak berlaku. Buka ulang aplikasi desktop.');
      let upstream = await send(token);
      if (upstream.status === 401) {
        // Token ditolak (mis. dirotasi): satu kali coba lagi dengan token yang dipaksa segar.
        token = await this.deps.token({ force: true });
        if (token) upstream = await send(token);
      }
      res.writeHead(upstream.status, pickResponse(upstream.headers, PASS_RESPONSE_HEADERS));
      if (!upstream.body) {
        res.end();
        return;
      }
      const body = Readable.fromWeb(upstream.body as never);
      // Dibatalkan di tengah stream (omp berhenti): putuskan respons lokal, bukan galat yang tak tertangani.
      body.on('error', () => res.destroy());
      body.pipe(res);
    } catch (error) {
      if (aborter.signal.aborted) return; // klien (omp) membatalkan
      this.deps.log?.(`proxy LLM gagal: ${error instanceof Error ? error.message : String(error)}`);
      reply(502, 'upstream_unreachable', 'Gateway tidak terjangkau dari worker.');
    }
  }
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error('too large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

function pick(headers: IncomingMessage['headers'], names: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of names) {
    const value = headers[name];
    if (typeof value === 'string') out[name] = value;
  }
  return out;
}

function pickResponse(headers: Headers, names: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of names) {
    const value = headers.get(name);
    if (value !== null) out[name] = value;
  }
  return out;
}
