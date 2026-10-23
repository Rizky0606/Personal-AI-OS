import {
  WS_CLOSE_UNAUTHORIZED,
  WS_HEARTBEAT_INTERVAL_MS,
  WORKER_WS_PATH,
  WorkerToGatewayFrameSchema,
  type GatewayToWorkerFrame,
  type WorkerCommand,
} from '@aios/contracts';
import type { FastifyBaseLogger, FastifyPluginCallback } from 'fastify';
import type { WebSocket } from 'ws';
import { requireAuth, requireScope } from '../auth/guard.js';
import type { AuthContext, AuthService } from '../auth/service.js';
import type { EventStore } from '../runs/store.js';

/** Kode penutupan untuk koneksi yang digantikan koneksi baru dari perangkat yang sama. */
export const WORKER_CLOSE_REPLACED = 4409;

export interface WorkerHub {
  /** Mengirim perintah ke worker yang sedang tersambung; false bila tidak ada koneksi. */
  send(deviceId: string, command: WorkerCommand): boolean;
  isOnline(deviceId: string): boolean;
}

export interface WorkerHubDeps {
  auth: AuthService;
  store: EventStore;
  /** Run ini milik project yang terdaftar atas perangkat worker tersebut? */
  ownsRun(deviceId: string, runId: string): Promise<boolean>;
  heartbeatMs?: number;
  now?: () => number;
}

/** Registri koneksi worker, satu per perangkat. */
export function createWorkerHub(): WorkerHub & {
  attach(deviceId: string, socket: WebSocket): void;
  detach(deviceId: string, socket: WebSocket): void;
} {
  const sockets = new Map<string, WebSocket>();
  return {
    attach(deviceId, socket) {
      const previous = sockets.get(deviceId);
      sockets.set(deviceId, socket);
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
      if (sockets.get(deviceId) === socket) sockets.delete(deviceId);
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
  const { hub, store } = deps;
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
      .then(async () => {
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
        if (!(await deps.ownsRun(auth.deviceId, runId))) {
          send({
            type: 'error',
            code: 'run_not_owned',
            message: 'Run ini bukan milik project yang terdaftar atas worker ini.',
            runId,
          });
          return;
        }
        await store.append(runId, event);
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
