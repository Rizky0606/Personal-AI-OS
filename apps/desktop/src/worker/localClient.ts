import {
  LocalPushSchema,
  LocalReadySchema,
  LocalResponseSchema,
  type LocalErrorCode,
  type LocalPush,
  type WorkerStatus,
} from '@aios/contracts';
import type { WsLink, WsOpen } from '../realtime/client';

export type LocalState = 'off' | 'connecting' | 'connected' | 'reconnecting';

export interface WorkerSnapshot {
  /** Sambungan desktop ke proses worker lokal. */
  local: LocalState;
  /** Status terakhir dari worker (koneksinya ke gateway); null selama belum tersambung. */
  status: WorkerStatus | null;
}

export type CallErrorCode = LocalErrorCode | 'not_connected' | 'timeout' | 'connection_lost';

export class WorkerCallError extends Error {
  constructor(
    readonly code: CallErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'WorkerCallError';
  }
}

export interface LocalClientDeps {
  /** Port dan token sekali pakai dari Tauri; memulai ulang worker bila token awal sudah terpakai. */
  connectInfo: () => Promise<{ port: number; token: string }>;
  open: WsOpen;
  /** Jeda sambung ulang ke-[attempt] (mulai 1). Bawaan 0,5 s naik dua kali lipat sampai 5 s. */
  backoffMs?: (attempt: number) => number;
  requestTimeoutMs?: number;
  helloTimeoutMs?: number;
}

export const defaultLocalBackoff = (attempt: number): number =>
  Math.min(5_000, 500 * 2 ** Math.max(attempt - 1, 0));

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: WorkerCallError) => void;
  timer: ReturnType<typeof setTimeout>;
}

const OFF: WorkerSnapshot = { local: 'off', status: null };

/**
 * Klien WebSocket ke worker lokal (127.0.0.1, port acak). Token berantai: balasan `ready` membawa token
 * untuk sambungan berikutnya; bila rantai putus (worker mati, ready tak sampai), Tauri memulai ulang
 * worker dan memberi token baru. Sambungan otomatis diulang dengan backoff.
 */
export class LocalWorkerClient {
  private snapshot: WorkerSnapshot = OFF;
  private readonly listeners = new Set<() => void>();
  private readonly pushListeners = new Set<(push: LocalPush) => void>();
  private readonly pending = new Map<string, Pending>();
  private running = false;
  private generation = 0;
  private attempt = 0;
  private port: number | null = null;
  private nextToken: string | null = null;
  private link: WsLink | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private helloTimer: ReturnType<typeof setTimeout> | undefined;
  private seq = 0;

  constructor(private readonly deps: LocalClientDeps) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): WorkerSnapshot => this.snapshot;

  /** Dorongan dari worker selain status: `session.updated` dan `session.invalid`. */
  onPush(listener: (push: LocalPush) => void): () => void {
    this.pushListeners.add(listener);
    return () => this.pushListeners.delete(listener);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.attempt = 0;
    void this.connect(++this.generation);
  }

  stop(): void {
    this.running = false;
    this.generation++;
    this.teardown();
    this.failPending(new WorkerCallError('connection_lost', 'Worker dihentikan.'));
    this.port = null;
    this.nextToken = null;
    this.set(OFF);
  }

  call(method: string, params?: object): Promise<unknown> {
    if (this.snapshot.local !== 'connected' || !this.link) {
      return Promise.reject(new WorkerCallError('not_connected', 'Worker belum tersambung.'));
    }
    const id = `r${++this.seq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new WorkerCallError('timeout', 'Worker tidak menjawab.'));
      }, this.deps.requestTimeoutMs ?? 15_000);
      this.pending.set(id, { resolve, reject, timer });
      this.link?.send(JSON.stringify({ id, method, ...(params ? { params } : {}) }));
    });
  }

  private set(next: WorkerSnapshot): void {
    this.snapshot = next;
    this.listeners.forEach((listener) => listener());
  }

  private teardown(): void {
    clearTimeout(this.retryTimer);
    clearTimeout(this.helloTimer);
    const link = this.link;
    this.link = null;
    link?.close();
  }

  private failPending(error: WorkerCallError): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
      this.pending.delete(id);
    }
  }

  private async connect(generation: number): Promise<void> {
    if (!this.running || generation !== this.generation) return;
    this.set({ local: this.attempt === 0 ? 'connecting' : 'reconnecting', status: null });

    let target: { port: number; token: string };
    try {
      target =
        this.port !== null && this.nextToken !== null
          ? { port: this.port, token: this.nextToken }
          : await this.deps.connectInfo();
    } catch {
      return this.retry(generation);
    }
    if (generation !== this.generation) return;
    this.port = target.port;
    this.nextToken = null; // dipakai sekarang; pengganti datang bersama `ready`

    let authed = false;
    let opened = false;
    let link: WsLink | undefined;
    const sendHello = () => {
      link?.send(JSON.stringify({ type: 'hello', token: target.token }));
      clearTimeout(this.helloTimer);
      this.helloTimer = setTimeout(() => link?.close(), this.deps.helloTimeoutMs ?? 5_000);
    };

    const handlers = {
      onOpen: () => {
        opened = true;
        if (link) sendHello();
      },
      onMessage: (text: string) => {
        if (generation !== this.generation) return;
        const raw = parseJson(text);
        if (!authed) {
          const ready = LocalReadySchema.safeParse(raw);
          if (!ready.success) return;
          authed = true;
          clearTimeout(this.helloTimer);
          this.nextToken = ready.data.nextToken;
          this.attempt = 0;
          this.link = link ?? null;
          this.set({ local: 'connected', status: null });
          return;
        }
        this.onMessage(raw);
      },
      onClose: () => {
        if (generation !== this.generation) return;
        clearTimeout(this.helloTimer);
        this.link = null;
        this.failPending(new WorkerCallError('connection_lost', 'Koneksi ke worker terputus.'));
        // Belum sempat terautentikasi: rantai token putus, minta worker (dan token) baru dari Tauri.
        if (!authed) {
          this.nextToken = null;
          this.port = null;
        }
        this.retry(generation);
      },
    };

    try {
      link = await this.deps.open(`ws://127.0.0.1:${target.port}`, {}, handlers);
    } catch {
      this.nextToken = null;
      this.port = null;
      return this.retry(generation);
    }
    if (generation !== this.generation) {
      link.close();
      return;
    }
    if (opened) sendHello();
  }

  private onMessage(raw: unknown): void {
    const push = LocalPushSchema.safeParse(raw);
    if (push.success) {
      if (push.data.push === 'status') {
        this.set({ local: this.snapshot.local, status: push.data.status });
      }
      this.pushListeners.forEach((listener) => listener(push.data));
      return;
    }
    const response = LocalResponseSchema.safeParse(raw);
    if (!response.success) return;
    const entry = this.pending.get(response.data.id);
    if (!entry) return;
    this.pending.delete(response.data.id);
    clearTimeout(entry.timer);
    if (response.data.ok) entry.resolve(response.data.result);
    else entry.reject(new WorkerCallError(response.data.error.code, response.data.error.message));
  }

  private retry(generation: number): void {
    if (!this.running || generation !== this.generation) return;
    this.attempt++;
    this.set({ local: 'reconnecting', status: null });
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(
      () => void this.connect(generation),
      (this.deps.backoffMs ?? defaultLocalBackoff)(this.attempt),
    );
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
