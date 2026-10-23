import { ServerMessageSchema, type ServerMessage } from '@aios/contracts';
import { WebSocket } from 'ws';

/** Klien WebSocket untuk tes: mengumpulkan semua pesan server (sudah divalidasi kontrak). */
export class TestWs {
  readonly messages: ServerMessage[] = [];
  readonly pings: number[] = [];
  closeEvent: { code: number; reason: string } | undefined;
  private readonly socket: WebSocket;
  private readonly waiters: (() => void)[] = [];
  readonly closed: Promise<void>;

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.on('message', (data: Buffer) => {
      this.messages.push(ServerMessageSchema.parse(JSON.parse(data.toString('utf8'))));
      this.wake();
    });
    socket.on('ping', () => this.pings.push(Date.now()));
    this.closed = new Promise<void>((resolve) => {
      socket.on('close', (code: number, reason: Buffer) => {
        this.closeEvent = { code, reason: reason.toString('utf8') };
        this.wake();
        resolve();
      });
    });
  }

  static async connect(
    url: string,
    token: string | undefined,
    options: { autoPong?: boolean } = {},
  ): Promise<TestWs> {
    const socket = new WebSocket(url, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      autoPong: options.autoPong ?? true,
    });
    const client = new TestWs(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('unexpected-response', (_req, res) => {
        reject(new Error(`HTTP ${res.statusCode}`));
      });
      socket.once('error', reject);
    });
    return client;
  }

  /** Handshake yang ditolak: mengembalikan status HTTP-nya. */
  static async rejected(url: string, token: string | undefined): Promise<number> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      socket.once('unexpected-response', (_req, res) => {
        resolve(res.statusCode ?? 0);
        res.resume();
      });
      socket.once('open', () => reject(new Error('seharusnya ditolak')));
      socket.once('error', () => undefined);
    });
  }

  send(message: object): void {
    this.socket.send(JSON.stringify(message));
  }

  /** Memutus tanpa jabat tangan penutup, seperti jaringan yang putus. */
  drop(): void {
    this.socket.terminate();
  }

  close(): void {
    this.socket.close();
  }

  envelopes(channel?: string) {
    return this.messages.flatMap((m) =>
      'v' in m && (channel === undefined || m.channel === channel) ? [m] : [],
    );
  }

  private wake() {
    for (const w of this.waiters.splice(0)) w();
  }

  /** Menunggu sampai `ok()` benar (diperiksa tiap pesan baru atau penutupan). */
  async until(ok: () => boolean, timeoutMs = 5000, label = 'kondisi'): Promise<void> {
    // Menunggu kondisi yang sehat selesai cepat; batas ini hanya terpakai saat tes gagal, jadi dibuat longgar
    // agar mesin yang sedang sibuk tidak membuat tes lolos-gagal acak.
    const deadline = Date.now() + Math.max(timeoutMs, 20_000);
    while (!ok()) {
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`timeout menunggu ${label}`);
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, Math.min(left, 100));
        this.waiters.push(() => {
          clearTimeout(t);
          resolve();
        });
      });
    }
  }
}
