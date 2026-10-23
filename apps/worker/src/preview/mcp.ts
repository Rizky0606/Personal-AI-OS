import { randomBytes, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import { BrowserError, type BrowserSession } from './browser.js';

/** Nama server di mcp.json; omp memberi awalan ini pada nama tool-nya. */
export const MCP_SERVER_NAME = 'aios_browser';

/** Awalan nama tool browser di omp (`mcp__<server>_<tool>`); dipakai mengenali tool ini pada permintaan izin. */
export const BROWSER_TOOL_PREFIX = `mcp__${MCP_SERVER_NAME}_`;

const PROTOCOL_VERSION = '2025-03-26';
const MAX_BODY = 256 * 1024;

type Json = Record<string, unknown>;
const isRecord = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Json;
}

const selectorProp = {
  type: 'string',
  description: 'Selector Playwright/CSS, mis. "button.simpan" atau "text=Kirim".',
};

export const TOOLS: ToolDef[] = [
  {
    name: 'browser_screenshot',
    description:
      'Tangkapan layar halaman preview project (dev server dijalankan otomatis). Atur width/height untuk menguji ukuran layar, ' +
      'mis. width 390 untuk ponsel. Isi selector untuk satu elemen saja. Beri reload=true setelah mengubah kode agar hasil terbaru yang diambil.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path halaman, mis. "/login". Kosong = halaman saat ini.',
        },
        width: {
          type: 'number',
          description: 'Lebar viewport (200-2560). Bertahan untuk panggilan berikutnya.',
        },
        height: { type: 'number', description: 'Tinggi viewport (200-1600).' },
        selector: selectorProp,
        fullPage: { type: 'boolean', description: 'Seluruh halaman (dibatasi 4000 px).' },
        reload: { type: 'boolean', description: 'Muat ulang halaman sebelum menangkap.' },
      },
    },
  },
  {
    name: 'browser_click',
    description: 'Klik elemen di halaman preview berdasarkan selector.',
    inputSchema: { type: 'object', properties: { selector: selectorProp }, required: ['selector'] },
  },
  {
    name: 'browser_fill',
    description: 'Isi kolom input/textarea di halaman preview berdasarkan selector.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: selectorProp,
        value: { type: 'string', description: 'Teks yang diisi.' },
      },
      required: ['selector', 'value'],
    },
  },
  {
    name: 'browser_console',
    description:
      'Baca pesan console, error halaman, dan request gagal (HTTP 4xx/5xx atau jaringan) sejak terakhir dibaca.',
    inputSchema: {
      type: 'object',
      properties: {
        clear: { type: 'boolean', description: 'Kosongkan setelah dibaca (default true).' },
      },
    },
  },
];

interface ToolResult {
  content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[];
  isError?: boolean;
}

const text = (value: string, isError = false): ToolResult => ({
  content: [{ type: 'text', text: value }],
  ...(isError ? { isError: true } : {}),
});

async function callTool(session: BrowserSession, name: string, args: Json): Promise<ToolResult> {
  try {
    switch (name) {
      case 'browser_screenshot': {
        const shot = await session.screenshot({
          path: str(args.path),
          selector: str(args.selector),
          width: num(args.width),
          height: num(args.height),
          fullPage: args.fullPage === true,
          reload: args.reload === true,
        });
        return {
          content: [
            {
              type: 'text',
              text: `Screenshot ${shot.url} (viewport ${shot.viewport.width}x${shot.viewport.height}). ${shot.layout}`,
            },
            { type: 'image', data: shot.png.toString('base64'), mimeType: 'image/png' },
          ],
        };
      }
      case 'browser_click': {
        const selector = str(args.selector);
        if (!selector) return text('selector wajib diisi.', true);
        const { url } = await session.click(selector);
        return text(`Diklik. Halaman sekarang: ${url}`);
      }
      case 'browser_fill': {
        const selector = str(args.selector);
        if (!selector || typeof args.value !== 'string')
          return text('selector dan value wajib diisi.', true);
        const { url } = await session.fill(selector, args.value);
        return text(`Terisi. Halaman sekarang: ${url}`);
      }
      case 'browser_console': {
        const result = session.readConsole(args.clear !== false);
        if (result.console.length === 0 && result.failedRequests.length === 0) {
          return text('Tidak ada pesan console atau request gagal.');
        }
        const lines = [
          ...result.console.map((e) => `[${e.level}] ${e.text}`),
          ...result.failedRequests.map((f) => `[request gagal] ${f}`),
        ];
        return text(lines.join('\n'));
      }
      default:
        return text(`Tool tidak dikenal: ${name}`, true);
    }
  } catch (error) {
    if (error instanceof BrowserError) return text(error.message, true);
    return text(`Tool gagal: ${error instanceof Error ? error.message : String(error)}`, true);
  }
}

export interface McpRegistration {
  /** Alamat endpoint MCP untuk mcp.json omp. */
  url: string;
  /** Header yang harus dikirim klien (token per run). */
  headers: Record<string, string>;
  unregister(): void;
}

/**
 * Server MCP lokal (Streamable HTTP, tanpa SSE) yang menyajikan tool browser ke omp. Mendengarkan di
 * loopback; setiap run punya token sendiri yang terikat ke sesi browser run itu, jadi satu run tidak
 * bisa menyentuh preview run lain.
 */
export class McpServer {
  private server: http.Server | undefined;
  private port = 0;
  private readonly sessions = new Map<string, { token: Buffer; session: BrowserSession }>();

  async start(): Promise<void> {
    if (this.server) return;
    const server = http.createServer((req, res) => void this.handle(req, res));
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('MCP lokal gagal mendengarkan');
    this.port = address.port;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    this.sessions.clear();
  }

  register(runId: string, session: BrowserSession): McpRegistration {
    const token = randomBytes(24).toString('hex');
    this.sessions.set(runId, { token: Buffer.from(token), session });
    return {
      url: `http://127.0.0.1:${this.port}/mcp/${encodeURIComponent(runId)}`,
      headers: { Authorization: `Bearer ${token}` },
      unregister: () => this.sessions.delete(runId),
    };
  }

  private authorize(req: http.IncomingMessage): BrowserSession | undefined {
    const match = /^\/mcp\/([^/?#]+)/.exec(req.url ?? '');
    const entry = match?.[1] ? this.sessions.get(decodeURIComponent(match[1])) : undefined;
    const header = req.headers.authorization ?? '';
    const given = Buffer.from(header.startsWith('Bearer ') ? header.slice(7) : '');
    if (given.length !== entry?.token.length || !timingSafeEqual(given, entry.token)) {
      return undefined;
    }
    return entry.session;
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const reply = (status: number, body?: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };
    const session = this.authorize(req);
    if (!session) return reply(401, { error: 'unauthorized' });
    if (req.method === 'DELETE') return reply(200);
    if (req.method !== 'POST') return reply(405, { error: 'method_not_allowed' });

    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > MAX_BODY) return reply(413, { error: 'too_large' });
      chunks.push(chunk);
    }
    let message: unknown;
    try {
      message = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      return reply(400, {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      });
    }
    const batch = Array.isArray(message);
    const responses: unknown[] = [];
    for (const item of batch ? (message as unknown[]) : [message]) {
      const response = await this.dispatch(session, item);
      if (response) responses.push(response);
    }
    // Hanya notifikasi: tidak ada jawaban.
    if (responses.length === 0) return reply(202);
    reply(200, batch ? responses : responses[0]);
  }

  private async dispatch(session: BrowserSession, item: unknown): Promise<Json | undefined> {
    if (!isRecord(item) || typeof item.method !== 'string') return undefined;
    const id = item.id;
    if (id === undefined || id === null) return undefined; // notifikasi
    const ok = (result: unknown) => ({ jsonrpc: '2.0', id, result });
    const fail = (code: number, message: string) => ({
      jsonrpc: '2.0',
      id,
      error: { code, message },
    });
    const params = isRecord(item.params) ? item.params : {};
    switch (item.method) {
      case 'initialize':
        return ok({
          protocolVersion: str(params.protocolVersion) ?? PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: MCP_SERVER_NAME, version: '1.0.0' },
          instructions:
            'Tool browser untuk melihat dan menguji preview project: screenshot, klik, isi kolom, baca console.',
        });
      case 'ping':
        return ok({});
      case 'tools/list':
        return ok({ tools: TOOLS });
      case 'tools/call': {
        const name = str(params.name);
        if (!name) return fail(-32602, 'name wajib');
        return ok(
          await callTool(session, name, isRecord(params.arguments) ? params.arguments : {}),
        );
      }
      default:
        return fail(-32601, `Method tidak dikenal: ${item.method}`);
    }
  }
}
