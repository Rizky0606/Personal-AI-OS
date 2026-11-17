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

/** Satu titik relay terdaftar: token lokalnya, run pemiliknya, dan jalur gateway tujuannya. */
interface RelayEndpoint {
  runId: string;
  /** Token acak per pendaftaran (bukan per run): token satu jalur tidak berlaku di jalur lain. */
  token: Buffer;
  /** Jalur di gateway, relatif terhadap `serverUrl()`. */
  upstream: string;
}

/**
 * Relay MCP lokal untuk server MCP yang disajikan gateway: tool gateway (`aios_tools`, POST /v1/mcp) dan
 * satu titik per konektor pemilik (POST /v1/mcp/connector/<id>, DESIGN_MCP_KONEKTOR.md #3). omp bicara ke
 * `127.0.0.1:<port>/mcp/<runId>` atau `127.0.0.1:<port>/mcp/<runId>/konektor/<id>` dengan token acak per
 * pendaftaran; relay meneruskan isi JSON-RPC apa adanya ke gateway dengan token perangkat worker yang selalu
 * segar dan `X-Aios-Run-Id` dari pendaftaran (bukan dari omp). Token perangkat tidak pernah masuk berkas atau
 * lingkungan omp (pola `LlmProxy`), token konektor tidak pernah sampai ke worker sama sekali, dan token satu
 * jalur tidak bisa dipakai untuk jalur atau run lain (pola server MCP browser).
 */
export class GatewayToolsRelay {
  private readonly server: Server;
  private port = 0;
  private starting: Promise<void> | undefined;
  /** Kunci peta adalah jalur loopback persis seperti yang dipanggil omp. */
  private readonly endpoints = new Map<string, RelayEndpoint>();

  constructor(private readonly deps: GatewayToolsRelayDeps) {
    this.server = createServer((req, res) => void this.handle(req, res));
  }

  /** Tool gateway (`aios_tools`) untuk satu run; server loopback dijalankan saat pendaftaran pertama. */
  async register(runId: string): Promise<McpRegistration> {
    return this.add(runId, `/mcp/${encodeURIComponent(runId)}`, '/v1/mcp');
  }

  /**
   * Satu konektor pemilik untuk satu run. Worker hanya tahu id-nya: URL dan token server pihak ketiga tetap
   * di gateway, yang menjadi klien MCP sebenarnya.
   */
  async registerConnector(runId: string, connectorId: string): Promise<McpRegistration> {
    const id = encodeURIComponent(connectorId);
    return this.add(
      runId,
      `/mcp/${encodeURIComponent(runId)}/konektor/${id}`,
      `/v1/mcp/connector/${id}`,
    );
  }

  /** Pendaftaran satu jalur loopback dengan token acaknya sendiri. */
  private async add(runId: string, path: string, upstream: string): Promise<McpRegistration> {
    this.starting ??= new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', () => {
        this.port = (this.server.address() as AddressInfo).port;
        resolve();
      });
    });
    await this.starting;
    const token = randomBytes(24).toString('hex');
    this.endpoints.set(path, { runId, token: Buffer.from(token), upstream });
    return {
      url: `http://127.0.0.1:${this.port}${path}`,
      headers: { Authorization: `Bearer ${token}` },
      unregister: () => {
        this.endpoints.delete(path);
      },
    };
  }

  async close(): Promise<void> {
    this.endpoints.clear();
    if (!this.starting) return;
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  /**
   * Titik relay pemilik permintaan bila jalur terdaftar dan tokennya cocok (perbandingan waktu-konstan).
   * Token diikat ke jalur, jadi token tool gateway tidak berlaku di jalur konektor dan sebaliknya.
   */
  private endpointOf(req: IncomingMessage): RelayEndpoint | undefined {
    const expected = this.endpoints.get(req.url ?? '');
    const given = Buffer.from(/^Bearer (.+)$/i.exec(req.headers.authorization ?? '')?.[1] ?? '');
    if (given.length !== expected?.token.length || !timingSafeEqual(given, expected.token))
      return undefined;
    return expected;
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
    const endpoint = this.endpointOf(req);
    if (!endpoint) return reply(401, { error: 'unauthorized' });
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
      (this.deps.fetch ?? fetch)(`${base}${endpoint.upstream}`, {
        method: 'POST',
        headers: { ...passed, authorization: `Bearer ${token}`, [RUN_ID_HEADER]: endpoint.runId },
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
