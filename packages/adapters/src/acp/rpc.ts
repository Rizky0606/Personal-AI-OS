import { AdapterError } from '../types.js';

/** Satu proses agent ACP: JSON-RPC per baris lewat stdin/stdout (docs/ADAPTER_ACP.md). Bentuk sama dengan `OmpTransport`. */
export interface AcpTransport {
  /** Mengirim satu frame; klien menambah newline. */
  write(frame: string): void;
  /** Baris stdout. Berakhir saat proses selesai. */
  lines: AsyncIterable<string>;
  /** Menutup stdin (shutdown bersih). */
  closeInput(): void;
  kill(): void;
  exited: Promise<{ code: number | null }>;
}
/** Penjaga bentuk kanonik untuk modul ACP; field tetap `unknown` dan dicek per pemakaian. */
export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export interface RpcError {
  code: number;
  message: string;
}

/** Galat JSON-RPC dari agent. */
export class AcpRpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'AcpRpcError';
  }
}

export interface AcpHandlers {
  /** Notifikasi dari agent (mis. `session/update`). */
  onNotification(method: string, params: unknown): void;
  /** Request dari agent; hasil dikirim sebagai respons. Lempar `AcpRpcError` untuk galat. */
  onRequest(method: string, params: unknown): Promise<unknown>;
  /** Baris stdout yang bukan JSON-RPC valid; diabaikan. */
  onInvalid?(line: string): void;
  /** Aliran berakhir (proses keluar atau stdout tertutup). Dipanggil sekali. */
  onClose(): void;
}

/**
 * JSON-RPC 2.0 dua arah di atas transport baris. Semua request yang menunggu ditolak saat koneksi
 * tertutup atau waktu habis, jadi pemanggil tidak pernah menggantung.
 */
export class AcpConnection {
  private nextId = 1;
  private closed = false;
  private readonly pending = new Map<
    number,
    {
      resolve: (v: unknown) => void;
      reject: (e: Error) => void;
      timer?: ReturnType<typeof setTimeout>;
    }
  >();

  constructor(
    private readonly transport: AcpTransport,
    private readonly handlers: AcpHandlers,
  ) {
    void this.read();
  }

  get isClosed(): boolean {
    return this.closed;
  }

  private send(frame: Record<string, unknown>): void {
    if (this.closed) return;
    this.transport.write(`${JSON.stringify({ jsonrpc: '2.0', ...frame })}\n`);
  }

  /** Request dengan batas waktu opsional (`timeoutMs` 0 = tanpa batas; mis. `session/prompt`). */
  request(method: string, params: unknown, timeoutMs = 0): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(new AdapterError('acp_exited', 'Proses agent sudah berhenti.', true));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const entry: {
        resolve: (v: unknown) => void;
        reject: (e: Error) => void;
        timer?: ReturnType<typeof setTimeout>;
      } = { resolve, reject };
      if (timeoutMs > 0) {
        entry.timer = setTimeout(() => {
          this.pending.delete(id);
          reject(
            new AdapterError(
              'acp_timeout',
              `Agent tidak menjawab ${method} dalam batas waktu.`,
              true,
            ),
          );
        }, timeoutMs);
      }
      this.pending.set(id, entry);
      this.send({ id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    this.send({ method, params });
  }

  /** Menolak semua request menunggu dan menandai koneksi tertutup. */
  private close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new AdapterError('acp_exited', 'Proses agent berhenti tiba-tiba.', true));
    }
    this.pending.clear();
    this.handlers.onClose();
  }

  /** Menutup koneksi dari sisi klien (tanpa memanggil `onClose`). */
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new AdapterError('acp_closed', 'Koneksi ditutup.', false));
    }
    this.pending.clear();
  }

  private async read(): Promise<void> {
    try {
      for await (const line of this.transport.lines) {
        if (!line.trim()) continue;
        let frame: unknown;
        try {
          frame = JSON.parse(line);
        } catch {
          this.handlers.onInvalid?.(line);
          continue;
        }
        if (!isRecord(frame)) {
          this.handlers.onInvalid?.(line);
          continue;
        }
        this.dispatch(frame);
      }
    } catch {
      // Pembaca gagal: diperlakukan sebagai proses berhenti.
    }
    await this.transport.exited.catch(() => undefined);
    this.close();
  }

  private dispatch(frame: Record<string, unknown>): void {
    const { id, method } = frame;
    if (typeof method === 'string') {
      if (id === undefined || id === null) {
        try {
          this.handlers.onNotification(method, frame.params);
        } catch {
          // Penangan notifikasi tidak boleh merusak pembaca.
        }
        return;
      }
      this.handlers
        .onRequest(method, frame.params)
        .then(
          (result) => this.send({ id, result: result ?? null }),
          (err: unknown) => {
            const e = err instanceof AcpRpcError ? err : new AcpRpcError(-32603, 'Internal error');
            this.send({ id, error: { code: e.code, message: e.message } });
          },
        )
        .catch(() => undefined);
      return;
    }
    if (typeof id !== 'number') return;
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    clearTimeout(entry.timer);
    if (isRecord(frame.error)) {
      const code = typeof frame.error.code === 'number' ? frame.error.code : -32603;
      const message = typeof frame.error.message === 'string' ? frame.error.message : 'error';
      entry.reject(new AcpRpcError(code, message));
    } else {
      entry.resolve(frame.result);
    }
  }
}
