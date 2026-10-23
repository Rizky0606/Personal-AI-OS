import {
  ServerMessageSchema,
  WS_CLOSE_UNAUTHORIZED,
  WS_HEARTBEAT_INTERVAL_MS,
  type EventEnvelope,
} from '@aios/contracts';

export type ConnectionState =
  | { kind: 'idle' }
  | { kind: 'connecting' }
  | { kind: 'connected' }
  | { kind: 'reconnecting'; attempt: number };

export interface WsHandlers {
  onOpen(): void;
  onMessage(text: string): void;
  /** [code] null bila putus tanpa frame penutup (jaringan mati). */
  onClose(code: number | null): void;
}

export interface WsLink {
  send(text: string): void;
  close(): void;
}

/** Membuka soket dengan header Authorization (webview tidak bisa memasang header; Tauri bisa). */
export type WsOpen = (
  url: string,
  headers: Record<string, string>,
  handlers: WsHandlers,
) => Promise<WsLink>;

export interface RealtimeDeps {
  open: WsOpen;
  serverUrl: () => string | null;
  token: () => Promise<string | null>;
  /** Token baru setelah server menolak [stale]; null bila sesi berakhir. */
  refreshed: (stale: string) => Promise<string | null>;
  /** Jeda sambung ulang ke-[attempt] (mulai 1). Bawaan: 1, 2, 4, ... detik sampai 30. */
  backoffMs?: (attempt: number) => number;
  heartbeatMs?: number;
  /** Batas menunggu jawaban setelah ping sebelum soket dianggap mati. */
  pongTimeoutMs?: number;
  /** Batas menunggu jawaban saat memeriksa soket setelah bangun dari tidur. */
  probeTimeoutMs?: number;
}

export function defaultBackoffMs(attempt: number): number {
  return Math.min(30_000, 1_000 * 2 ** Math.max(attempt - 1, 0));
}

/** `https://host/x` -> `wss://host/x/v1/ws`. */
export function wsUrlFor(serverUrl: string): string {
  const url = new URL(serverUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/v1/ws`;
  return url.toString();
}

type Handler = (envelope: EventEnvelope) => void;

/**
 * Satu koneksi WebSocket bersama. Saat putus, menyambung ulang dengan backoff dan berlangganan lagi dengan
 * `lastSeq` terakhir (channel `run:*`), sehingga event yang terlewat diputar ulang server tanpa hilang atau ganda.
 * Soket yang mati diam-diam (laptop tidur, Wi-Fi hilang) ditangkap heartbeat dan `probe()`.
 */
export class RealtimeClient {
  private state: ConnectionState = { kind: 'idle' };
  private readonly stateListeners = new Set<() => void>();
  private readonly handlers = new Map<string, Set<Handler>>();
  private readonly lastSeq = new Map<string, number>();
  private link: WsLink | null = null;
  private generation = 0;
  private running = false;
  /** Handshake selesai untuk koneksi saat ini (bisa datang sebelum tautan soket dikembalikan open()). */
  private opened = false;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private deadlineTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly deps: RealtimeDeps) {}

  subscribeState = (listener: () => void): (() => void) => {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  };

  getState = (): ConnectionState => this.state;

  private setState(next: ConnectionState): void {
    this.state = next;
    this.stateListeners.forEach((l) => l());
  }

  /** Berlangganan channel (`user`, `run:<id>`, `conversation:<id>`); mengembalikan fungsi berhenti. */
  subscribe(channel: string, handler: Handler): () => void {
    let set = this.handlers.get(channel);
    if (!set) {
      set = new Set();
      this.handlers.set(channel, set);
      this.send({ type: 'subscribe', channel, lastSeq: this.lastSeq.get(channel) ?? 0 });
    }
    set.add(handler);
    return () => {
      const current = this.handlers.get(channel);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) {
        this.handlers.delete(channel);
        this.send({ type: 'unsubscribe', channel });
      }
    };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.attempt = 0;
    void this.connect();
  }

  stop(): void {
    this.running = false;
    this.teardown();
    this.setState({ kind: 'idle' });
  }

  /** Jaringan kembali: lewati sisa backoff. */
  reconnectNow(): void {
    if (!this.running || this.state.kind === 'connected' || this.state.kind === 'connecting')
      return;
    clearTimeout(this.retryTimer);
    void this.connect();
  }

  /**
   * Setelah bangun dari tidur soket sering sudah mati tanpa ada yang memberi tahu: kirim ping dan bila tidak
   * ada jawaban dalam batas waktu, putus lalu sambung ulang segera.
   */
  probe(): void {
    if (!this.running) return;
    if (this.state.kind === 'reconnecting') return this.reconnectNow();
    if (this.state.kind !== 'connected') return;
    this.send({ type: 'ping' });
    this.armDeadline(this.deps.probeTimeoutMs ?? 4_000);
  }

  private async connect(): Promise<void> {
    if (!this.running) return;
    const generation = ++this.generation;
    this.opened = false;
    this.setState(
      this.attempt === 0 ? { kind: 'connecting' } : { kind: 'reconnecting', attempt: this.attempt },
    );
    let token: string | null;
    try {
      token = await this.deps.token();
    } catch {
      return this.retry(generation);
    }
    if (generation !== this.generation) return;
    const server = this.deps.serverUrl();
    if (!token || !server) {
      // Tanpa sesi tidak ada yang bisa disambungkan; start() berikutnya (setelah login) memulai lagi.
      this.running = false;
      this.setState({ kind: 'idle' });
      return;
    }
    try {
      const link = await this.deps.open(
        wsUrlFor(server),
        { authorization: `Bearer ${token}` },
        {
          onOpen: () => this.handleOpen(generation),
          onMessage: (text) => this.handleMessage(generation, text),
          onClose: (code) => void this.handleClose(generation, code, token),
        },
      );
      if (generation !== this.generation) return link.close();
      this.link = link;
      this.flushOpen(generation);
    } catch {
      this.retry(generation);
    }
  }

  private handleOpen(generation: number): void {
    if (generation !== this.generation) return;
    this.opened = true;
    this.flushOpen(generation);
  }

  /** Berlangganan dan mulai heartbeat setelah handshake selesai DAN tautan soket sudah ada, mana pun yang lebih dulu. */
  private flushOpen(generation: number): void {
    if (
      generation !== this.generation ||
      !this.opened ||
      !this.link ||
      this.state.kind === 'connected'
    )
      return;
    this.attempt = 0;
    this.setState({ kind: 'connected' });
    for (const channel of this.handlers.keys()) {
      this.send({ type: 'subscribe', channel, lastSeq: this.lastSeq.get(channel) ?? 0 });
    }
    this.startHeartbeat();
  }

  private handleMessage(generation: number, text: string): void {
    if (generation !== this.generation) return;
    // Sembarang frame membuktikan soket hidup.
    clearTimeout(this.deadlineTimer);
    let json: unknown;
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      return;
    }
    const parsed = ServerMessageSchema.safeParse(json);
    if (!parsed.success || !('event' in parsed.data)) return;
    const envelope = parsed.data;
    if (envelope.channel.startsWith('run:')) {
      // Event run punya log permanen: seq yang sudah diterima tidak diproses dua kali.
      if (envelope.seq <= (this.lastSeq.get(envelope.channel) ?? 0)) return;
      this.lastSeq.set(envelope.channel, envelope.seq);
    }
    this.handlers.get(envelope.channel)?.forEach((h) => h(envelope));
  }

  private async handleClose(generation: number, code: number | null, token: string): Promise<void> {
    if (generation !== this.generation) return;
    this.teardown();
    if (!this.running) return;
    if (code === WS_CLOSE_UNAUTHORIZED) {
      const fresh = await this.deps.refreshed(token).catch(() => null);
      if (!this.running) return;
      if (fresh) {
        void this.connect();
        return;
      }
    }
    this.retry(this.generation);
  }

  private retry(generation: number): void {
    if (!this.running || generation !== this.generation) return;
    this.attempt += 1;
    this.setState({ kind: 'reconnecting', attempt: this.attempt });
    const delay = (this.deps.backoffMs ?? defaultBackoffMs)(this.attempt);
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => void this.connect(), delay);
  }

  private startHeartbeat(): void {
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: 'ping' });
      this.armDeadline(this.deps.pongTimeoutMs ?? 10_000);
    }, this.deps.heartbeatMs ?? WS_HEARTBEAT_INTERVAL_MS);
  }

  /** Tidak ada frame sampai batas waktu: soket dianggap mati, putus dan sambung ulang segera. */
  private armDeadline(ms: number): void {
    clearTimeout(this.deadlineTimer);
    const generation = this.generation;
    this.deadlineTimer = setTimeout(() => {
      if (generation !== this.generation || !this.running) return;
      this.teardown();
      this.attempt = Math.max(this.attempt, 0);
      void this.connect();
    }, ms);
  }

  private send(message: object): void {
    if (this.state.kind !== 'connected' || !this.link) return;
    try {
      this.link.send(JSON.stringify(message));
    } catch {
      // Soket sedang putus; heartbeat atau onClose yang menyambung ulang.
    }
  }

  private teardown(): void {
    this.generation++;
    clearInterval(this.heartbeatTimer);
    clearTimeout(this.deadlineTimer);
    clearTimeout(this.retryTimer);
    const link = this.link;
    this.link = null;
    try {
      link?.close();
    } catch {
      // Sudah tertutup.
    }
  }
}
