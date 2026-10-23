import {
  GatewayToWorkerFrameSchema,
  TokenPairSchema,
  WORKER_WS_PATH,
  WS_CLOSE_UNAUTHORIZED,
  WS_HEARTBEAT_INTERVAL_MS,
  type AgentEvent,
  type GatewayState,
  type WorkerCommand,
} from '@aios/contracts';
import { WebSocket } from 'ws';

export interface GatewaySession {
  serverUrl: string;
  accessToken: string;
  refreshToken: string;
  deviceId: string;
}

export interface GatewayLinkDeps {
  onCommand: (command: WorkerCommand) => void;
  fetch?: typeof fetch;
  now?: () => number;
  /** Jeda sebelum percobaan ke-`attempt` (mulai 1). Default 1, 2, 4, 8, 16, 30 detik. */
  backoffMs?: (attempt: number) => number;
  heartbeatMs?: number;
  pongTimeoutMs?: number;
  /** Token dianggap hampir habis bila sisa waktunya kurang dari ini. */
  refreshSkewMs?: number;
}

/** Penutupan karena digantikan koneksi lain dari perangkat yang sama (kode gateway). */
const CLOSE_REPLACED = 4409;
const BACKOFF_STEPS = [1000, 2000, 4000, 8000, 16000, 30000];

export const defaultBackoff = (attempt: number): number =>
  BACKOFF_STEPS[Math.min(attempt, BACKOFF_STEPS.length) - 1] ?? 30_000;

/** `exp` JWT dalam ms epoch, atau undefined bila tidak terbaca. */
export function tokenExpiryMs(jwt: string): number | undefined {
  try {
    const payload = JSON.parse(
      Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString('utf8'),
    ) as {
      exp?: unknown;
    };
    return typeof payload.exp === 'number' ? payload.exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}

export function workerWsUrl(serverUrl: string): string {
  const url = new URL(serverUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${url.toString().replace(/\/$/, '')}/v1${WORKER_WS_PATH}`;
}

type RefreshOutcome = 'ok' | 'invalid' | 'retry';

/**
 * Koneksi keluar worker ke gateway (`/v1/worker/ws`, token scope worker). Menyambung ulang dengan backoff,
 * memperbarui token sendiri (refresh dirotasi, jadi hanya satu refresh pada satu waktu), dan melaporkan
 * token baru lewat `onSession` supaya desktop menyimpannya.
 */
export class GatewayLink {
  private session: GatewaySession | null = null;
  private current: GatewayState = 'offline';
  private socket: WebSocket | null = null;
  private generation = 0;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private deadline: ReturnType<typeof setTimeout> | undefined;
  private refreshing: Promise<RefreshOutcome> | null = null;
  /** Gateway menolak token ini (4401/401) tetapi refresh belum berhasil: percobaan berikutnya wajib refresh dulu. */
  private tokenRejected = false;
  private readonly stateListeners = new Set<(state: GatewayState) => void>();
  private readonly sessionListeners = new Set<(session: GatewaySession) => void>();
  private readonly invalidListeners = new Set<() => void>();

  constructor(private readonly deps: GatewayLinkDeps) {}

  get state(): GatewayState {
    return this.current;
  }

  get deviceId(): string | null {
    return this.session?.deviceId ?? null;
  }

  onState(listener: (state: GatewayState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  /** Dipanggil setiap token dirotasi; pemilik wajib menyimpan refresh token baru. */
  onSession(listener: (session: GatewaySession) => void): () => void {
    this.sessionListeners.add(listener);
    return () => this.sessionListeners.delete(listener);
  }

  /** Refresh ditolak (perangkat dicabut atau token terpakai ulang): sesi dibuang. */
  onInvalid(listener: () => void): () => void {
    this.invalidListeners.add(listener);
    return () => this.invalidListeners.delete(listener);
  }

  setSession(session: GatewaySession): void {
    this.session = session;
    this.tokenRejected = false;
    this.restart();
  }

  clearSession(): void {
    this.session = null;
    this.teardown();
    this.setState('offline');
  }

  /** Menyambung ulang segera (mis. setelah PC bangun dari tidur). */
  reconnectNow(): void {
    if (this.session) this.restart();
  }

  /** Mengirim event run ke gateway; false bila tidak tersambung. */
  sendEvent(runId: string, event: AgentEvent): boolean {
    if (this.current !== 'connected' || this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify({ type: 'run.event', runId, event }));
    return true;
  }

  stop(): void {
    this.session = null;
    this.teardown();
    this.setState('offline');
  }

  private restart(): void {
    this.teardown();
    this.attempt = 0;
    void this.connect(this.generation);
  }

  private teardown(): void {
    this.generation++;
    clearTimeout(this.retryTimer);
    clearInterval(this.heartbeat);
    clearTimeout(this.deadline);
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.removeAllListeners();
      socket.on('error', () => undefined);
      socket.terminate();
    }
  }

  private setState(next: GatewayState): void {
    if (this.current === next) return;
    this.current = next;
    this.stateListeners.forEach((listener) => listener(next));
  }

  private async connect(generation: number): Promise<void> {
    if (!this.session || generation !== this.generation) return;
    this.setState(this.attempt === 0 ? 'connecting' : 'reconnecting');

    const expiry = tokenExpiryMs(this.session.accessToken);
    const now = (this.deps.now ?? Date.now)();
    if (
      this.tokenRejected ||
      (expiry !== undefined && expiry - now < (this.deps.refreshSkewMs ?? 30_000))
    ) {
      const outcome = await this.refresh();
      if (generation !== this.generation) return;
      if (outcome !== 'ok') return this.afterRefreshFailure(outcome, generation);
    }
    this.open(generation);
  }

  private open(generation: number): void {
    const session = this.session;
    if (!session || generation !== this.generation) return;
    let socket: WebSocket;
    try {
      socket = new WebSocket(workerWsUrl(session.serverUrl), {
        headers: { authorization: `Bearer ${session.accessToken}` },
        handshakeTimeout: 10_000,
      });
    } catch {
      this.scheduleRetry(generation);
      return;
    }
    this.socket = socket;

    socket.on('message', (data: Buffer, isBinary: boolean) => {
      if (generation !== this.generation || isBinary) return;
      let raw: unknown;
      try {
        raw = JSON.parse(data.toString('utf8'));
      } catch {
        return;
      }
      const frame = GatewayToWorkerFrameSchema.safeParse(raw);
      if (!frame.success) return;
      const value = frame.data;
      if (value.type === 'ready') {
        this.attempt = 0;
        this.setState('connected');
        this.startHeartbeat(socket, generation);
      } else if (value.type === 'pong') {
        clearTimeout(this.deadline);
      } else if (value.type !== 'error') {
        this.deps.onCommand(value);
      }
    });

    socket.on('unexpected-response', (_req, res) => {
      res.resume();
      if (generation !== this.generation) return;
      this.dropSocket(socket);
      if (res.statusCode === 401) void this.recoverFromUnauthorized(generation);
      else this.scheduleRetry(generation);
    });

    socket.on('close', (code: number) => {
      if (generation !== this.generation) return;
      this.dropSocket(socket);
      if (code === WS_CLOSE_UNAUTHORIZED) void this.recoverFromUnauthorized(generation);
      else if (code === CLOSE_REPLACED) this.setState('offline');
      else this.scheduleRetry(generation);
    });

    socket.on('error', () => undefined); // close/unexpected-response menyusul
  }

  private dropSocket(socket: WebSocket): void {
    clearInterval(this.heartbeat);
    clearTimeout(this.deadline);
    if (this.socket === socket) this.socket = null;
  }

  private startHeartbeat(socket: WebSocket, generation: number): void {
    clearInterval(this.heartbeat);
    this.heartbeat = setInterval(() => {
      if (generation !== this.generation || socket.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({ type: 'ping' }));
      clearTimeout(this.deadline);
      // Soket mati diam-diam (PC tidur, Wi-Fi hilang): putuskan lalu sambung ulang.
      this.deadline = setTimeout(() => socket.terminate(), this.deps.pongTimeoutMs ?? 10_000);
    }, this.deps.heartbeatMs ?? WS_HEARTBEAT_INTERVAL_MS);
  }

  private async recoverFromUnauthorized(generation: number): Promise<void> {
    this.tokenRejected = true;
    const outcome = await this.refresh();
    if (generation !== this.generation) return;
    if (outcome === 'ok') {
      this.attempt = 0;
      this.open(generation);
    } else {
      this.afterRefreshFailure(outcome, generation);
    }
  }

  private afterRefreshFailure(outcome: Exclude<RefreshOutcome, 'ok'>, generation: number): void {
    if (outcome === 'invalid') {
      this.session = null;
      this.teardown();
      this.setState('offline');
      this.invalidListeners.forEach((listener) => listener());
    } else {
      this.scheduleRetry(generation);
    }
  }

  private scheduleRetry(generation: number): void {
    if (!this.session || generation !== this.generation) return;
    this.attempt++;
    this.setState('reconnecting');
    const delay = (this.deps.backoffMs ?? defaultBackoff)(this.attempt);
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => void this.connect(generation), delay);
  }

  /** Satu refresh pada satu waktu: refresh token dirotasi, pemakaian ganda mencabut perangkat. */
  private refresh(): Promise<RefreshOutcome> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<RefreshOutcome> {
    const session = this.session;
    if (!session) return 'invalid';
    try {
      const response = await (this.deps.fetch ?? fetch)(`${session.serverUrl}/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      });
      if (response.status === 400 || response.status === 401) return 'invalid';
      if (!response.ok) return 'retry';
      const pair = TokenPairSchema.safeParse(await response.json());
      if (!pair.success) return 'retry';
      // Sesi bisa diganti selagi menunggu; hanya terapkan bila masih sesi yang sama.
      if (this.session !== session) return 'retry';
      this.session = {
        ...session,
        accessToken: pair.data.accessToken,
        refreshToken: pair.data.refreshToken,
      };
      this.tokenRejected = false;
      this.sessionListeners.forEach((listener) => listener(this.session!));
      return 'ok';
    } catch {
      return 'retry';
    }
  }
}
