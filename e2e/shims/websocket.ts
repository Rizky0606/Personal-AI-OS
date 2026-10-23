import { controlUrl } from './control';

interface Message {
  type: string;
  data: unknown;
}

/**
 * Pengganti plugin-websocket: soket dibuka oleh server kendali (Node) supaya header Authorization bisa dipasang
 * saat handshake dan tidak ada header Origin (worker lokal menolak Origin).
 */
export default class E2EWebSocket {
  private listeners: ((message: Message) => void)[] = [];

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', (event) => {
      this.emit({ type: 'Text', data: String(event.data) });
    });
    socket.addEventListener('close', (event) => {
      this.emit({ type: 'Close', data: { code: event.code, reason: event.reason } });
    });
  }

  static connect(
    url: string,
    config?: { headers?: Record<string, string> },
  ): Promise<E2EWebSocket> {
    const bridge = new URL(controlUrl().replace(/^http/, 'ws') + '/bridge');
    bridge.searchParams.set('url', url);
    bridge.searchParams.set('headers', JSON.stringify(config?.headers ?? {}));
    const socket = new WebSocket(bridge);
    return new Promise((resolve, reject) => {
      socket.addEventListener('open', () => resolve(new E2EWebSocket(socket)), { once: true });
      socket.addEventListener('error', () => reject(new Error('E2E: sambungan WebSocket gagal')), {
        once: true,
      });
    });
  }

  private emit(message: Message) {
    for (const listener of this.listeners) listener(message);
  }

  addListener(listener: (message: Message) => void): () => void {
    this.listeners.push(listener);
    return () => (this.listeners = this.listeners.filter((l) => l !== listener));
  }

  send(message: string | { type: string; data: unknown }): Promise<void> {
    this.socket.send(typeof message === 'string' ? message : JSON.stringify(message));
    return Promise.resolve();
  }

  disconnect(): Promise<void> {
    this.socket.close();
    return Promise.resolve();
  }
}
