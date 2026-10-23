import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  LOCAL_PROTOCOL_VERSION,
  LocalHelloSchema,
  LocalRequestSchema,
  type LocalErrorCode,
  type LocalPush,
  type LocalRequest,
  type LocalResponse,
  type WorkerStatus,
} from '@aios/contracts';
import { WebSocketServer, type WebSocket } from 'ws';
import { PathError } from '../paths/normalize.js';

export interface LocalServerDeps {
  /** Token sekali pakai untuk koneksi pertama (dari Tauri). */
  token: string;
  handle: (request: LocalRequest) => Promise<unknown>;
  status: () => WorkerStatus;
  helloTimeoutMs?: number;
  log?: (message: string) => void;
}

export const CLOSE_BAD_TOKEN = 4401;
export const CLOSE_REPLACED = 4409;
const MAX_MESSAGE_BYTES = 64 * 1024;
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

const digest = (value: string) => createHash('sha256').update(value).digest();
const sameToken = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

/**
 * Server WebSocket lokal untuk aplikasi desktop: hanya 127.0.0.1, port acak, dan token berantai. Token
 * dipakai sekali: balasan `ready` membawa token untuk koneksi berikutnya. Koneksi yang membawa header
 * `Origin` (halaman web di peramban) ditolak, jadi situs lain tidak bisa menyambung ke worker.
 */
export class LocalServer {
  private readonly http: Server;
  private readonly wss: WebSocketServer;
  private token: string;
  private client: WebSocket | null = null;

  constructor(private readonly deps: LocalServerDeps) {
    this.token = deps.token;
    this.http = createServer((_req, res) => {
      res.writeHead(426).end();
    });
    this.wss = new WebSocketServer({
      server: this.http,
      maxPayload: MAX_MESSAGE_BYTES,
      verifyClient: ({ req }, done) => {
        const remote = req.socket.remoteAddress ?? '';
        if (req.headers.origin !== undefined || !LOOPBACK.has(remote)) {
          done(false, 403, 'Forbidden');
        } else {
          done(true);
        }
      },
    });
    this.wss.on('connection', (socket) => this.onConnection(socket));
  }

  /** Mulai mendengarkan di 127.0.0.1 pada port acak; mengembalikan port. */
  async start(): Promise<number> {
    await new Promise<void>((resolve, reject) => {
      this.http.once('error', reject);
      this.http.listen(0, '127.0.0.1', resolve);
    });
    return (this.http.address() as AddressInfo).port;
  }

  async close(): Promise<void> {
    for (const socket of this.wss.clients) socket.terminate();
    this.wss.close();
    await new Promise<void>((resolve) => this.http.close(() => resolve()));
  }

  /** Kirim dorongan ke klien yang sudah terautentikasi (bila ada). */
  push(message: LocalPush): void {
    this.send(this.client, message);
  }

  private send(socket: WebSocket | null, message: object): void {
    if (socket?.readyState === socket?.OPEN) socket?.send(JSON.stringify(message));
  }

  private onConnection(socket: WebSocket): void {
    let authed = false;
    const timer = setTimeout(() => {
      if (!authed) socket.close(CLOSE_BAD_TOKEN, 'hello_timeout');
    }, this.deps.helloTimeoutMs ?? 5000);

    socket.on('close', () => {
      clearTimeout(timer);
      if (this.client === socket) this.client = null;
    });
    socket.on('error', () => undefined);

    socket.on('message', (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        socket.close(1003, 'binary_not_supported');
        return;
      }
      const text = data.toString('utf8');
      if (!authed) {
        authed = this.authenticate(socket, text);
        if (authed) clearTimeout(timer);
        return;
      }
      void this.dispatch(socket, text);
    });
  }

  private authenticate(socket: WebSocket, text: string): boolean {
    const hello = LocalHelloSchema.safeParse(safeJson(text));
    // Token salah tidak memutar token berantai: klien sah tetap bisa masuk dengan token yang benar.
    if (!hello.success || !sameToken(hello.data.token, this.token)) {
      socket.close(CLOSE_BAD_TOKEN, 'bad_token');
      return false;
    }
    this.token = randomBytes(32).toString('hex');
    const previous = this.client;
    this.client = socket;
    if (previous && previous !== socket) previous.close(CLOSE_REPLACED, 'replaced');
    this.send(socket, { type: 'ready', version: LOCAL_PROTOCOL_VERSION, nextToken: this.token });
    this.push({ push: 'status', status: this.deps.status() });
    return true;
  }

  private async dispatch(socket: WebSocket, text: string): Promise<void> {
    const raw = safeJson(text);
    const request = LocalRequestSchema.safeParse(raw);
    if (!request.success) {
      const id =
        typeof (raw as { id?: unknown } | undefined)?.id === 'string'
          ? (raw as { id: string }).id
          : '';
      this.send(socket, failure(id, 'invalid_request', 'Permintaan tidak dikenali.'));
      return;
    }
    try {
      const result = await this.deps.handle(request.data);
      this.send(socket, { id: request.data.id, ok: true, result } satisfies LocalResponse);
    } catch (error) {
      if (error instanceof PathError) {
        this.send(socket, failure(request.data.id, error.code, error.message));
      } else {
        this.deps.log?.(`galat internal pada ${request.data.method}: ${String(error)}`);
        this.send(socket, failure(request.data.id, 'internal', 'Terjadi kesalahan di worker.'));
      }
    }
  }
}

function failure(id: string, code: LocalErrorCode, message: string): LocalResponse {
  return { id, ok: false, error: { code, message } };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
