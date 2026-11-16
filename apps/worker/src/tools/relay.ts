import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { RUN_ID_HEADER } from '@aios/contracts';
import type { McpRegistration } from '../preview/mcp.js';

const MAX_BODY_BYTES = 256 * 1024;
/** Header MCP dari omp yang boleh diteruskan; Authorization lokal tidak pernah ikut. */
const PASS_REQUEST_HEADERS = ['content-type', 'accept', 'mcp-protocol-version'];

export interface GatewayToolsRelayDeps {
  /** Alamat gateway (https://host); null bila belum ada sesi. */
  serverUrl: () => string | null;
  /** Access token worker yang berlaku; `force` memaksa refresh setelah gateway menolak token. */
  token: (options?: { force?: boolean }) => Promise<string | null>;
  fetch?: typeof fetch;
  log?: (message: string) => void;
}

/**
 * Relay MCP lokal untuk tool gateway (`aios_tools`, POST /v1/mcp). omp bicara ke
 * `127.0.0.1:<port>/mcp/<runId>` dengan token acak per run; relay meneruskan isi JSON-RPC apa adanya ke gateway
 * dengan token perangkat worker yang selalu segar dan `X-Aios-Run-Id` dari pendaftaran (bukan dari omp). Token
 * perangkat tidak pernah masuk berkas atau lingkungan omp (pola `LlmProxy`), dan token satu run tidak bisa
 * dipakai untuk run lain (pola server MCP browser).
 */
export class GatewayToolsRelay {
  private readonly server: Server;
  private port = 0;
  private starting: Promise<void> | undefined;
  private readonly runs = new Map<string, Buffer>();

  constructor(private readonly deps: GatewayToolsRelayDeps) {
    this.server = createServer((req, res) => void this.handle(req, res));
  }

  /** Didaftarkan per run oleh koordinator; server loopback dijalankan saat pendaftaran pertama. */
  async register(runId: string): Promise<McpRegistration> {
    this.starting ??= new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', () => {
        this.port = (this.server.address() as AddressInfo).port;
        resolve();
      });
    });
    await this.starting;
    const token = randomBytes(24).toString('hex');
    this.runs.set(runId, Buffer.from(token));
    return {
      url: `http://127.0.0.1:${this.port}/mcp/${encodeURIComponent(runId)}`,
      headers: { Authorization: `Bearer ${token}` },
      unregister: () => {
        this.runs.delete(runId);
      },
    };
  }

  async close(): Promise<void> {
    this.runs.clear();
    if (!this.starting) return;
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  /** Run pemilik permintaan bila path dan token per run cocok (perbandingan waktu-konstan). */
  private runOf(req: IncomingMessage): string | undefined {
    const match = /^\/mcp\/([^/?#]+)$/.exec(req.url ?? '');
    const runId = match?.[1] ? decodeURIComponent(match[1]) : undefined;
    const expected = runId ? this.runs.get(runId) : undefined;
    const given = Buffer.from(/^Bearer (.+)$/i.exec(req.headers.authorization ?? '')?.[1] ?? '');
    if (given.length !== expected?.length || !timingSafeEqual(given, expected)) return undefined;
    return runId;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const reply = (status: number, body?: unknown, headers: Record<string, string> = {}) => {
      if (res.headersSent) {
        res.end();
        return;
      }
      res.writeHead(status, {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      });
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };
    const runId = this.runOf(req);
    if (!runId) return reply(401, { error: 'unauthorized' });
    // Gateway tidak menyediakan aliran SSE maupun sesi; dijawab lokal tanpa perjalanan ke gateway.
    if (req.method === 'GET') return reply(405, undefined, { allow: 'POST, DELETE' });
    if (req.method === 'DELETE') return reply(204);
    if (req.method !== 'POST') return reply(405, undefined, { allow: 'POST, DELETE' });

    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) return reply(413, { error: 'too_large' });
      chunks.push(chunk);
    }
    const base = this.deps.serverUrl();
    if (!base) return reply(503, { error: 'no_session' });

    const aborter = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) aborter.abort();
    });
    const body = Buffer.concat(chunks);
    const passed: Record<string, string> = {};
    for (const name of PASS_REQUEST_HEADERS) {
      const value = req.headers[name];
      if (typeof value === 'string') passed[name] = value;
    }
    const send = (token: string) =>
      (this.deps.fetch ?? fetch)(`${base}/v1/mcp`, {
        method: 'POST',
        headers: { ...passed, authorization: `Bearer ${token}`, [RUN_ID_HEADER]: runId },
        body: new Uint8Array(body),
        signal: aborter.signal,
      });

    try {
      let token = await this.deps.token();
      if (!token) return reply(503, { error: 'no_session' });
      let upstream = await send(token);
      if (upstream.status === 401) {
        // Token ditolak (mis. dirotasi): satu kali coba lagi dengan token yang dipaksa segar.
        token = await this.deps.token({ force: true });
        if (token) upstream = await send(token);
      }
      const text = await upstream.text();
      const type = upstream.headers.get('content-type');
      res.writeHead(upstream.status, type ? { 'content-type': type } : {});
      res.end(text === '' ? undefined : text);
    } catch (error) {
      if (aborter.signal.aborted) return;
      this.deps.log?.(
        `relay tool gateway gagal: ${error instanceof Error ? error.message : String(error)}`,
      );
      reply(502, { error: 'upstream_unreachable' });
    }
  }
}
