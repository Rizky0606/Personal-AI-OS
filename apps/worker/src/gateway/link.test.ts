import type { WorkerCommand } from '@aios/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEVICE, FakeGateway, RUN, fresh, jwt, until } from '../testing/fake-gateway.js';
import {
  GatewayLink,
  defaultBackoff,
  tokenExpiryMs,
  workerWsUrl,
  type GatewaySession,
} from './link.js';

let gateway: FakeGateway;
let links: GatewayLink[];
beforeEach(async () => {
  gateway = new FakeGateway();
  links = [];
  await gateway.start();
});
afterEach(async () => {
  links.forEach((l) => l.stop());
  await gateway.stop();
});

const session = (over: Partial<GatewaySession> = {}): GatewaySession => ({
  serverUrl: gateway.url,
  accessToken: fresh(),
  refreshToken: 'refresh-1',
  deviceId: DEVICE,
  ...over,
});

function makeLink(over: Partial<ConstructorParameters<typeof GatewayLink>[0]> = {}) {
  const commands: WorkerCommand[] = [];
  const link = new GatewayLink({
    onCommand: (c) => commands.push(c),
    backoffMs: () => 20,
    ...over,
  });
  links.push(link);
  const states: string[] = [];
  link.onState((s) => states.push(s));
  return { link, commands, states };
}

const tokenResponse = (accessToken: string, refreshToken: string) =>
  new Response(JSON.stringify({ accessToken, refreshToken, expiresIn: 900 }), { status: 200 });

describe('GatewayLink: sambung dan kirim', () => {
  it('tersambung dengan header Authorization, menerima ready, lalu mengirim event run', async () => {
    const { link, states } = makeLink();
    const s = session();

    link.setSession(s);
    await until(() => link.state === 'connected', 'connected');

    expect(gateway.last.auth).toBe(`Bearer ${s.accessToken}`);
    expect(states).toEqual(['connecting', 'connected']);
    expect(link.sendEvent(RUN, { type: 'run.status', status: 'running' })).toBe(true);
    await until(() => gateway.received.length > 0, 'event');
    expect(gateway.received[0]).toEqual({
      type: 'run.event',
      runId: RUN,
      event: { type: 'run.status', status: 'running' },
    });
  });

  it('sendEvent mengembalikan false saat belum tersambung', () => {
    const { link } = makeLink();
    expect(link.sendEvent(RUN, { type: 'run.status', status: 'running' })).toBe(false);
  });

  it('meneruskan perintah dari gateway; frame tidak dikenal diabaikan', async () => {
    const { link, commands } = makeLink();
    link.setSession(session());
    await until(() => link.state === 'connected', 'connected');

    gateway.last.socket.send(JSON.stringify({ type: 'omong-kosong' }));
    gateway.last.socket.send(JSON.stringify({ type: 'run.cancel', runId: RUN }));

    await until(() => commands.length === 1, 'perintah');
    expect(commands[0]).toEqual({ type: 'run.cancel', runId: RUN });
  });
});

describe('GatewayLink: run ditolak gateway', () => {
  it('error run_not_active / run_not_owned memanggil onRunRejected; error lain diabaikan', async () => {
    const rejected: string[] = [];
    const { link } = makeLink({ onRunRejected: (runId) => rejected.push(runId) });
    link.setSession(session());
    await until(() => link.state === 'connected', 'connected');

    gateway.last.socket.send(
      JSON.stringify({ type: 'error', code: 'run_not_active', message: 'x', runId: RUN }),
    );
    gateway.last.socket.send(
      JSON.stringify({ type: 'error', code: 'run_not_owned', message: 'x', runId: RUN }),
    );
    gateway.last.socket.send(
      JSON.stringify({ type: 'error', code: 'invalid_message', message: 'x' }),
    );

    await until(() => rejected.length === 2, 'run ditolak');
    expect(rejected).toEqual([RUN, RUN]);
  });
});

describe('GatewayLink: reconnect', () => {
  it('putus lalu menyambung ulang otomatis dan kembali connected', async () => {
    const { link, states } = makeLink();
    link.setSession(session());
    await until(() => link.state === 'connected', 'connected');

    gateway.last.socket.terminate();
    await until(() => gateway.conns.length === 2 && link.state === 'connected', 'tersambung ulang');

    expect(states).toEqual(['connecting', 'connected', 'reconnecting', 'connected']);
  });

  it('server mati lalu hidup lagi: terus mencoba dengan backoff sampai berhasil', async () => {
    const { link } = makeLink();
    gateway.handshake = 503;
    link.setSession(session());
    await until(() => link.state === 'reconnecting', 'reconnecting');
    await new Promise((r) => setTimeout(r, 120));
    expect(link.state).toBe('reconnecting');

    gateway.handshake = 'ok';

    await until(() => link.state === 'connected', 'pulih');
  });

  it('heartbeat: tanpa pong soket diputus dan disambung ulang', async () => {
    const { link } = makeLink({ heartbeatMs: 30, pongTimeoutMs: 30 });
    gateway.autoPong = false;
    link.setSession(session());
    await until(() => link.state === 'connected', 'connected');

    await until(() => gateway.conns.length >= 2, 'sambung ulang karena tanpa pong');

    gateway.autoPong = true;
    await until(() => link.state === 'connected', 'connected lagi');
  });

  it('reconnectNow memutus koneksi lama dan menyambung baru', async () => {
    const { link } = makeLink();
    link.setSession(session());
    await until(() => link.state === 'connected', 'connected');

    link.reconnectNow();

    await until(() => gateway.conns.length === 2 && link.state === 'connected', 'koneksi baru');
  });

  it('digantikan koneksi lain (4409): berhenti, tidak berebut koneksi', async () => {
    const { link } = makeLink();
    link.setSession(session());
    await until(() => link.state === 'connected', 'connected');

    gateway.last.socket.close(4409, 'replaced');
    await until(() => link.state === 'offline', 'offline');
    await new Promise((r) => setTimeout(r, 120));

    expect(gateway.conns).toHaveLength(1);
  });

  it('defaultBackoff naik 1, 2, 4, 8, 16, lalu tertahan di 30 detik', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map(defaultBackoff)).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000,
    ]);
  });
});

describe('GatewayLink: token', () => {
  it('ditutup 4401: refresh lalu sambung ulang dengan token baru, dan melaporkan sesi baru', async () => {
    const newAccess = fresh();
    const fetchMock = vi.fn().mockResolvedValue(tokenResponse(newAccess, 'refresh-2'));
    const { link } = makeLink({ fetch: fetchMock as unknown as typeof fetch });
    const updates: GatewaySession[] = [];
    link.onSession((s) => updates.push(s));
    link.setSession(session());
    await until(() => link.state === 'connected', 'connected');

    gateway.last.socket.close(4401, 'token_expired');
    await until(() => gateway.conns.length === 2 && link.state === 'connected', 'sambung ulang');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string)).toEqual({
      refreshToken: 'refresh-1',
    });
    expect(gateway.last.auth).toBe(`Bearer ${newAccess}`);
    expect(updates).toMatchObject([{ accessToken: newAccess, refreshToken: 'refresh-2' }]);
  });

  it('token sudah habis saat mulai: refresh dulu sebelum menyambung', async () => {
    const newAccess = fresh();
    const fetchMock = vi.fn().mockResolvedValue(tokenResponse(newAccess, 'refresh-2'));
    const { link } = makeLink({ fetch: fetchMock as unknown as typeof fetch });

    link.setSession(session({ accessToken: jwt(Math.floor(Date.now() / 1000) - 10) }));
    await until(() => link.state === 'connected', 'connected');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(gateway.conns).toHaveLength(1);
    expect(gateway.last.auth).toBe(`Bearer ${newAccess}`);
  });

  it('handshake ditolak 401: refresh lalu coba lagi', async () => {
    const newAccess = fresh();
    const fetchMock = vi.fn().mockImplementation(() => {
      gateway.handshake = 'ok';
      return Promise.resolve(tokenResponse(newAccess, 'refresh-2'));
    });
    const { link } = makeLink({ fetch: fetchMock as unknown as typeof fetch });
    gateway.handshake = 401;

    link.setSession(session());

    await until(() => link.state === 'connected', 'connected');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refresh ditolak 401 (perangkat dicabut): sesi dibuang, offline, dan pemilik diberi tahu', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }));
    const { link } = makeLink({ fetch: fetchMock as unknown as typeof fetch });
    const invalid = vi.fn();
    link.onInvalid(invalid);
    link.setSession(session());
    await until(() => link.state === 'connected', 'connected');

    gateway.last.socket.close(4401, 'device_revoked');
    await until(() => invalid.mock.calls.length === 1, 'invalid');

    expect(link.state).toBe('offline');
    expect(link.deviceId).toBeNull();
    await new Promise((r) => setTimeout(r, 100));
    expect(gateway.conns).toHaveLength(1);
  });

  it('refresh gagal karena jaringan: sesi dipertahankan dan dicoba lagi', async () => {
    const newAccess = fresh();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('jaringan putus'))
      .mockResolvedValue(tokenResponse(newAccess, 'refresh-2'));
    const { link } = makeLink({ fetch: fetchMock as unknown as typeof fetch });
    const invalid = vi.fn();
    link.onInvalid(invalid);
    link.setSession(session());
    await until(() => link.state === 'connected', 'connected');

    gateway.last.socket.close(4401, 'token_expired');
    await until(() => gateway.conns.length === 2 && link.state === 'connected', 'pulih');

    expect(invalid).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sesi diganti saat refresh berjalan: hasil refresh lama dibuang, token sesi baru dipakai', async () => {
    let resolveFetch: (r: Response) => void = () => undefined;
    const fetchMock = vi.fn().mockReturnValue(new Promise<Response>((r) => (resolveFetch = r)));
    const { link } = makeLink({ fetch: fetchMock as unknown as typeof fetch });
    link.setSession(session({ accessToken: jwt(Math.floor(Date.now() / 1000) - 10) }));
    await until(() => fetchMock.mock.calls.length === 1, 'refresh sesi lama');

    const replacement = session({ accessToken: fresh(), refreshToken: 'refresh-baru' });
    link.setSession(replacement);
    await until(() => link.state === 'connected', 'connected dengan sesi baru');
    resolveFetch(tokenResponse(fresh(), 'refresh-lama-dirotasi'));
    await new Promise((r) => setTimeout(r, 50));

    expect(gateway.last.auth).toBe(`Bearer ${replacement.accessToken}`);
    expect(link.state).toBe('connected');
  });
});

describe('GatewayLink: siklus hidup', () => {
  it('clearSession memutus koneksi dan tidak menyambung lagi', async () => {
    const { link } = makeLink();
    link.setSession(session());
    await until(() => link.state === 'connected', 'connected');

    link.clearSession();
    await new Promise((r) => setTimeout(r, 100));

    expect(link.state).toBe('offline');
    expect(link.deviceId).toBeNull();
    expect(gateway.conns).toHaveLength(1);
  });

  it('mengganti sesi memutus koneksi lama dan memakai token baru', async () => {
    const { link } = makeLink();
    link.setSession(session());
    await until(() => link.state === 'connected', 'connected');
    const replacement = session({ accessToken: fresh() });

    link.setSession(replacement);

    await until(() => gateway.conns.length === 2 && link.state === 'connected', 'sesi baru');
    expect(gateway.last.auth).toBe(`Bearer ${replacement.accessToken}`);
  });
});

describe('helper', () => {
  it('tokenExpiryMs membaca exp JWT; token rusak undefined', () => {
    expect(tokenExpiryMs(jwt(1_000))).toBe(1_000_000);
    expect(tokenExpiryMs('bukan-jwt')).toBeUndefined();
  });

  it('workerWsUrl: https menjadi wss, http menjadi ws, path /v1/worker/ws', () => {
    expect(workerWsUrl('https://aios.contoh.com')).toBe('wss://aios.contoh.com/v1/worker/ws');
    expect(workerWsUrl('http://127.0.0.1:3000')).toBe('ws://127.0.0.1:3000/v1/worker/ws');
    expect(workerWsUrl('https://contoh.com/aios')).toBe('wss://contoh.com/aios/v1/worker/ws');
  });
});
