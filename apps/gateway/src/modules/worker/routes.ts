import {
  WS_CLOSE_UNAUTHORIZED,
  WS_HEARTBEAT_INTERVAL_MS,
  WORKER_WS_PATH,
  WorkerToGatewayFrameSchema,
  type AgentEvent,
  type GatewayToWorkerFrame,
  type WorkerCommand,
} from '@aios/contracts';
import type { FastifyBaseLogger, FastifyPluginCallback } from 'fastify';
import type { WebSocket } from 'ws';
import { requireAuth, requireScope } from '../auth/guard.js';
import type { AuthContext, AuthService } from '../auth/service.js';

/** Kode penutupan untuk koneksi yang digantikan koneksi baru dari perangkat yang sama. */
export const WORKER_CLOSE_REPLACED = 4409;

export type PresenceListener = (deviceId: string, online: boolean) => void;

export interface WorkerHub {
  /** Mengirim perintah ke worker yang sedang tersambung; false bila tidak ada koneksi. */
  send(deviceId: string, command: WorkerCommand): boolean;
  isOnline(deviceId: string): boolean;
}

export interface WorkerHubDeps {
  auth: AuthService;
  /** Event run dari worker diteruskan ke runner lewat relay; hasilnya menentukan balasan ke worker. */
  onRunEvent(deviceId: string, runId: string, event: AgentEvent): 'ok' | 'not_active' | 'not_owned';
  heartbeatMs?: number;
  now?: () => number;
}

/** Registri koneksi worker, satu per perangkat. */
export function createWorkerHub(): WorkerHub & {
  attach(deviceId: string, socket: WebSocket): void;
  detach(deviceId: string, socket: WebSocket): void;
  /** Dipanggil saat perangkat worker tersambung atau terputus (bukan saat sekadar digantikan koneksi baru). */
  onPresence(listener: PresenceListener): void;
} {
  const sockets = new Map<string, WebSocket>();
  const presence: PresenceListener[] = [];
  return {
    onPresence(listener) {
      presence.push(listener);
    },
    attach(deviceId, socket) {
      const previous = sockets.get(deviceId);
      sockets.set(deviceId, socket);
      if (!previous) presence.forEach((listener) => listener(deviceId, true));
      else if (previous.readyState !== previous.OPEN) presence.forEach((l) => l(deviceId, true));
      if (previous && previous !== socket) {
        const frame: GatewayToWorkerFrame = {
          type: 'error',
          code: 'replaced',
          message: 'Koneksi baru dari perangkat ini menggantikan yang lama.',
        };
        if (previous.readyState === previous.OPEN) previous.send(JSON.stringify(frame));
        previous.close(WORKER_CLOSE_REPLACED, 'replaced');
      }
    },
    detach(deviceId, socket) {
      if (sockets.get(deviceId) !== socket) return;
      sockets.delete(deviceId);
      presence.forEach((listener) => listener(deviceId, false));
    },
    send(deviceId, command) {
      const socket = sockets.get(deviceId);
      if (!socket || socket.readyState !== socket.OPEN) return false;
      socket.send(JSON.stringify(command));
      return true;
    },
    isOnline(deviceId) {
      return sockets.get(deviceId)?.readyState === 1;
    },
  };
}

function handleConnection(
  socket: WebSocket,
  auth: AuthContext,
  deps: WorkerHubDeps & { hub: ReturnType<typeof createWorkerHub> },
  log: FastifyBaseLogger,
): void {
  const { hub } = deps;
  const heartbeatMs = deps.heartbeatMs ?? WS_HEARTBEAT_INTERVAL_MS;
  const now = deps.now ?? Date.now;
  const send = (frame: GatewayToWorkerFrame) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(frame));
  };

  hub.attach(auth.deviceId, socket);
  send({ type: 'ready', deviceId: auth.deviceId });

  // Pesan diproses berurutan agar seq event satu run tidak tertukar.
  let chain: Promise<void> = Promise.resolve();
  socket.on('message', (data: Buffer, isBinary: boolean) => {
    chain = chain
      .then(() => {
        let raw: unknown;
        try {
          raw = isBinary ? undefined : JSON.parse(data.toString('utf8'));
        } catch {
          raw = undefined;
        }
        const frame = WorkerToGatewayFrameSchema.safeParse(raw);
        if (!frame.success) {
          send({ type: 'error', code: 'invalid_message', message: 'Pesan tidak dikenali.' });
          return;
        }
        if (frame.data.type === 'ping') {
          send({ type: 'pong' });
          return;
        }
        const { runId, event } = frame.data;
        const result = deps.onRunEvent(auth.deviceId, runId, event);
        if (result === 'not_owned') {
          send({
            type: 'error',
            code: 'run_not_owned',
            message: 'Run ini bukan milik project yang terdaftar atas worker ini.',
            runId,
          });
        } else if (result === 'not_active') {
          send({
            type: 'error',
            code: 'run_not_active',
            message: 'Run ini tidak sedang berjalan di gateway.',
            runId,
          });
        }
      })
      .catch((err: unknown) => log.error({ err }, 'worker ws: gagal memproses pesan'));
  });

  let alive = true;
  socket.on('pong', () => {
    alive = true;
  });
  const timer = setInterval(() => {
    void (async () => {
      if (!alive) {
        socket.terminate();
        return;
      }
      alive = false;
      if (now() >= auth.expiresAt) {
        socket.close(WS_CLOSE_UNAUTHORIZED, 'token_expired');
        return;
      }
      if (!(await deps.auth.deviceActive(auth.deviceId).catch(() => true))) {
        socket.close(WS_CLOSE_UNAUTHORIZED, 'device_revoked');
        return;
      }
      if (socket.readyState === socket.OPEN) socket.ping();
    })();
  }, heartbeatMs);

  socket.on('close', () => {
    clearInterval(timer);
    hub.detach(auth.deviceId, socket);
  });
  socket.on('error', (err) => log.warn({ err }, 'worker ws: error koneksi'));
}

/** `GET /v1/worker/ws` (upgrade). Header Authorization saat handshake; scope `worker`. */
export const workerRoutes: FastifyPluginCallback<
  WorkerHubDeps & { hub: ReturnType<typeof createWorkerHub> }
> = (app, deps, done) => {
  app.get(WORKER_WS_PATH, { websocket: true, onRequest: requireScope('worker') }, (socket, req) => {
    handleConnection(socket, requireAuth(req), deps, req.log);
  });
  done();
};
