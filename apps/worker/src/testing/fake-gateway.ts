import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';

export const DEVICE = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';
export const RUN = '0192f0c4-7a1b-7c2d-9e3f-4a5b6c7d8e90';

/** Gateway palsu untuk tes: menerima WebSocket worker, bisa menolak handshake, menutup dengan kode tertentu. */
export const jwt = (expSeconds: number) =>
  `h.${Buffer.from(JSON.stringify({ exp: expSeconds })).toString('base64url')}.s`;
export const fresh = () => jwt(Math.floor(Date.now() / 1000) + 3600);

export interface Conn {
  socket: WebSocket;
  auth: string | undefined;
}

export class FakeGateway {
  readonly conns: Conn[] = [];
  readonly received: unknown[] = [];
  /** Jawaban untuk handshake berikutnya: 'ok' atau status HTTP penolakan. */
  handshake: 'ok' | number = 'ok';
  autoReady = true;
  autoPong = true;
  private readonly http: Server;
  private readonly wss = new WebSocketServer({ noServer: true });
  url = '';

  constructor() {
    this.http = createServer();
    this.http.on('upgrade', (req, socket, head) => {
      const auth = req.headers.authorization;
      if (this.handshake !== 'ok') {
        socket.write(
          `HTTP/1.1 ${this.handshake} X\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
        );
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        const conn: Conn = { socket: ws, auth };
        this.conns.push(conn);
        ws.on('message', (data: Buffer) => {
          const message = JSON.parse(data.toString('utf8')) as { type: string };
          this.received.push(message);
          if (message.type === 'ping' && this.autoPong) ws.send(JSON.stringify({ type: 'pong' }));
        });
        if (this.autoReady) ws.send(JSON.stringify({ type: 'ready', deviceId: DEVICE }));
      });
    });
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve) => this.http.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.http.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    for (const { socket } of this.conns) socket.terminate();
    this.wss.close();
    await new Promise<void>((resolve) => this.http.close(() => resolve()));
  }

  get last(): Conn {
    const conn = this.conns.at(-1);
    if (!conn) throw new Error('belum ada koneksi');
    return conn;
  }
}

export async function until(check: () => boolean, label: string, ms = 3000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error(`timeout menunggu ${label}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}
