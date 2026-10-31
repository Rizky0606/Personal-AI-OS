import type { TeamEvent } from '@aios/contracts';
import {
  ClientMessageSchema,
  WS_CLOSE_UNAUTHORIZED,
  WS_HEARTBEAT_INTERVAL_MS,
  WS_MAX_CHANNELS,
  WS_PROTOCOL_VERSION,
  type Channel,
  type ServerMessage,
} from '@aios/contracts';
import type { FastifyPluginCallback, FastifyBaseLogger } from 'fastify';
import type { WebSocket } from 'ws';
import { requireAuth, requireScope } from '../auth/guard.js';
import type { AuthContext, AuthService } from '../auth/service.js';
import type { EventHub, HubEvent } from '../runs/hub.js';
import type { EventStore } from '../runs/store.js';

export interface WsDeps {
  auth: AuthService;
  hub: EventHub;
  store: EventStore;
  teamStore: {
    head(teamId: string): Promise<number>;
    list(
      teamId: string,
      afterSeq: number,
      limit: number,
    ): Promise<{ seq: number; ts: string; event: TeamEvent }[]>;
  };
  /** Apakah sumber channel ada; dipakai sebelum berlangganan. */
  exists: {
    run(id: string): Promise<boolean>;
    conversation(id: string): Promise<boolean>;
    team(id: string): Promise<boolean>;
  };
  heartbeatMs?: number;
  now?: () => number;
}

const REPLAY_BATCH = 500;
/** Klien yang tertinggal jauh diputus; ia sambung ulang dan memutar ulang dari database tanpa kehilangan event. */
const MAX_BUFFERED_BYTES = 1024 * 1024;
export const MAX_MESSAGE_BYTES = 16 * 1024;

interface Sub {
  unsubscribe: () => void;
  /** Seq terakhir yang sudah dikirim; event dengan seq <= ini adalah duplikat. */
  sentSeq: number;
  /** false selama replay: event live ditahan di `queue` agar urutan tetap benar. */
  ready: boolean;
  queue: HubEvent[];
}

function handleConnection(
  socket: WebSocket,
  auth: AuthContext,
  deps: WsDeps,
  log: FastifyBaseLogger,
): void {
  const { hub, store } = deps;
  const heartbeatMs = deps.heartbeatMs ?? WS_HEARTBEAT_INTERVAL_MS;
  const now = deps.now ?? Date.now;
  const subs = new Map<Channel, Sub>();
  let closed = false;

  const send = (message: ServerMessage) => {
    if (socket.readyState !== socket.OPEN) return;
    if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      socket.close(1013, 'klien terlalu lambat, sambung ulang dengan lastSeq');
      return;
    }
    socket.send(JSON.stringify(message));
  };

  const deliver = (channel: Channel, sub: Sub, e: HubEvent) => {
    if (e.seq <= sub.sentSeq) return;
    sub.sentSeq = e.seq;
    send({ v: WS_PROTOCOL_VERSION, channel, seq: e.seq, ts: e.ts, event: e.event });
  };

  const drop = (channel: Channel) => {
    subs.get(channel)?.unsubscribe();
    subs.delete(channel);
  };

  async function subscribe(channel: Channel, lastSeq: number | undefined) {
    // Berlangganan ulang ke channel yang sama berarti mulai dari lastSeq baru.
    drop(channel);
    if (subs.size >= WS_MAX_CHANNELS) {
      send({
        type: 'error',
        code: 'too_many_channels',
        message: `Maksimal ${WS_MAX_CHANNELS} channel per koneksi.`,
        channel,
      });
      return;
    }

    const [kind, id] = channel.split(':') as [string, string | undefined];
    const found =
      kind === 'run' && id
        ? await deps.exists.run(id)
        : kind === 'conversation' && id
          ? await deps.exists.conversation(id)
          : kind === 'team' && id
            ? await deps.exists.team(id)
            : true;
    if (!found) {
      send({ type: 'error', code: 'not_found', message: 'Channel tidak ditemukan.', channel });
      return;
    }
    if (closed) return;

    const sub: Sub = {
      unsubscribe: () => undefined,
      sentSeq: lastSeq ?? 0,
      ready: false,
      queue: [],
    };
    // Daftar ke hub SEBELUM membaca database: event yang tersimpan di antara keduanya masuk antrean,
    // dan duplikatnya dibuang lewat sentSeq.
    sub.unsubscribe = hub.subscribe(channel, (e) => {
      if (sub.ready) deliver(channel, sub, e);
      else sub.queue.push(e);
    });
    subs.set(channel, sub);

    if (kind === 'run' && id) {
      const head = await store.head(id);
      send({ type: 'subscribed', channel, lastSeq: head, replay: true });
      if (lastSeq === undefined) sub.sentSeq = head;
      else {
        for (;;) {
          const batch = await store.list(id, sub.sentSeq, REPLAY_BATCH);
          for (const row of batch)
            deliver(channel, sub, { seq: row.seq, ts: row.ts, event: row.event });
          if (batch.length < REPLAY_BATCH) break;
        }
      }
    } else if (kind === 'team' && id) {
      const head = await deps.teamStore.head(id);
      send({ type: 'subscribed', channel, lastSeq: head, replay: true });
      if (lastSeq === undefined) sub.sentSeq = head;
      else {
        for (;;) {
          const batch = await deps.teamStore.list(id, sub.sentSeq, REPLAY_BATCH);
          for (const row of batch)
            deliver(channel, sub, { seq: row.seq, ts: row.ts, event: row.event });
          if (batch.length < REPLAY_BATCH) break;
        }
      }
    } else {
      send({ type: 'subscribed', channel, lastSeq: 0, replay: false });
    }
    if (subs.get(channel) !== sub) return; // berhenti berlangganan / koneksi tutup saat replay
    // Tanpa await di bawah ini: antrean dikosongkan dan `ready` menyala dalam satu giliran.
    for (const e of sub.queue) deliver(channel, sub, e);
    sub.queue = [];
    sub.ready = true;
  }

  // Pesan diproses berurutan agar subscribe lalu unsubscribe tidak saling menyalip.
  let chain: Promise<void> = Promise.resolve();
  socket.on('message', (data: Buffer, isBinary: boolean) => {
    chain = chain
      .then(async () => {
        if (isBinary || data.length > MAX_MESSAGE_BYTES) {
          send({
            type: 'error',
            code: 'invalid_message',
            message: 'Kirim JSON teks (maks. 16 KB).',
          });
          return;
        }
        let raw: unknown;
        try {
          raw = JSON.parse(data.toString('utf8'));
        } catch {
          raw = undefined;
        }
        const msg = ClientMessageSchema.safeParse(raw);
        if (!msg.success) {
          send({ type: 'error', code: 'invalid_message', message: 'Pesan tidak dikenali.' });
          return;
        }
        if (msg.data.type === 'ping') send({ type: 'pong' });
        else if (msg.data.type === 'unsubscribe') drop(msg.data.channel);
        else await subscribe(msg.data.channel, msg.data.lastSeq);
      })
      .catch((err: unknown) => log.error({ err }, 'ws: gagal memproses pesan'));
  });

  // Heartbeat: ping tiap interval, putus bila pong tidak kembali; sekaligus menutup koneksi yang token-nya
  // habis atau perangkatnya dicabut (klien refresh token lalu menyambung ulang dengan lastSeq).
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
    closed = true;
    clearInterval(timer);
    for (const channel of [...subs.keys()]) drop(channel);
  });
  socket.on('error', (err) => log.warn({ err }, 'ws: error koneksi'));
}

/** `GET /v1/ws` (upgrade). Autentikasi lewat header Authorization saat handshake; scope `app`. */
export const wsRoutes: FastifyPluginCallback<WsDeps> = (app, deps, done) => {
  app.get('/ws', { websocket: true, onRequest: requireScope('app') }, (socket, req) => {
    handleConnection(socket, requireAuth(req), deps, req.log);
  });
  done();
};
