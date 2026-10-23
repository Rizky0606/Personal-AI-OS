import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProblem, AuthSession, LoginInputError, REFRESH_SKEW_MS } from './authSession';
import {
  MAX_SECRET_BYTES,
  SessionVault,
  type SecretStore,
  type SessionRecord,
} from './secretStore';

class MemoryStore implements SecretStore {
  readonly data = new Map<string, string>();
  fail = false;

  get(key: string) {
    if (this.fail) return Promise.reject(new Error('rusak'));
    return Promise.resolve(this.data.get(key) ?? null);
  }

  set(key: string, value: string) {
    this.data.set(key, value);
    return Promise.resolve();
  }

  remove(key: string) {
    this.data.delete(key);
    return Promise.resolve();
  }
}

const SERVER = 'https://aios.contoh.com';
const NOW = Date.UTC(2026, 9, 22, 6, 0, 0);
const DEVICE = {
  id: '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f',
  kind: 'desktop',
  name: 'PC-KERJA',
  scopes: ['app'],
  lastSeenAt: null,
  createdAt: '2026-10-22T06:00:00.000Z',
};

const record = (over: Partial<SessionRecord> = {}): SessionRecord => ({
  serverUrl: SERVER,
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  accessExpiresAt: NOW + 15 * 60_000,
  deviceId: DEVICE.id,
  deviceName: 'PC-KERJA',
  ...over,
});

const json = (status: number, body: unknown) =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const problem = (status: number, code: string, detail = 'detail') =>
  json(status, { type: `urn:aios:problem:${code}`, title: 't', status, detail, code });

const tokens = (access: string, refresh: string, expiresIn = 900) =>
  json(200, { accessToken: access, refreshToken: refresh, expiresIn });

interface Call {
  url: string;
  method: string;
  auth: string | null;
  body: unknown;
}

function setup(initial: SessionRecord | null = null) {
  const store = new MemoryStore();
  if (initial) store.data.set('session', JSON.stringify(initial));
  const calls: Call[] = [];
  const handlers: Record<string, (call: Call) => Response | Promise<Response>> = {};
  let clock = NOW;
  const fetcher = vi.fn((input: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const call: Call = {
      url: input,
      method: init?.method ?? 'GET',
      auth: headers.get('authorization'),
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null,
    };
    calls.push(call);
    const path = new URL(input).pathname.replace('/v1', '');
    const handler = handlers[path];
    return Promise.resolve(handler ? handler(call) : problem(404, 'not_found'));
  });
  const session = new AuthSession({
    vault: new SessionVault(store),
    fetcher,
    deviceName: () => Promise.resolve('PC-KERJA'),
    now: () => clock,
  });
  return {
    store,
    calls,
    handlers,
    session,
    advance: (ms: number) => {
      clock += ms;
    },
    callsTo: (path: string) => calls.filter((c) => c.url.endsWith(`/v1${path}`)),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe('login', () => {
  it('menyimpan sesi di vault dan masuk; tidak ada langkah Hubungkan terpisah', async () => {
    const t = setup();
    t.handlers['/auth/login'] = () =>
      json(200, { accessToken: 'a1', refreshToken: 'r1', expiresIn: 900, device: DEVICE });

    await t.session.login(' aios.contoh.com/ ', 'rahasia-panjang', '123456');

    const state = t.session.getState();
    expect(state.status).toBe('signedIn');
    const saved = JSON.parse(t.store.data.get('session') ?? '{}') as SessionRecord;
    expect(saved).toMatchObject({
      serverUrl: SERVER,
      accessToken: 'a1',
      refreshToken: 'r1',
      deviceId: DEVICE.id,
    });
    expect(saved.accessExpiresAt).toBe(NOW + 900_000);
    const call = t.callsTo('/auth/login')[0]!;
    expect(call.auth).toBeNull();
    expect(call.body).toEqual({
      password: 'rahasia-panjang',
      totp: '123456',
      device: { name: 'PC-KERJA', kind: 'desktop' },
    });
  });

  it('alamat tidak sah ditolak sebelum ada request', async () => {
    const t = setup();
    await expect(t.session.login('', 'p', '123456')).rejects.toMatchObject({
      reason: 'server_empty',
    });
    await expect(t.session.login('http://aios.contoh.com', 'p', '123456')).rejects.toBeInstanceOf(
      LoginInputError,
    );
    expect(t.calls).toHaveLength(0);
  });

  it('password atau TOTP salah: ApiProblem 401 dan tidak menyimpan apa pun', async () => {
    const t = setup();
    t.handlers['/auth/login'] = () => problem(401, 'invalid_credentials');

    await expect(t.session.login(SERVER, 'salah', '123456')).rejects.toMatchObject({
      status: 401,
      code: 'invalid_credentials',
    });
    expect(t.store.data.size).toBe(0);
    expect(t.session.getState().status).toBe('loading');
  });

  it('server tidak terjangkau menjadi ApiProblem jaringan', async () => {
    const t = setup();
    t.handlers['/auth/login'] = () => Promise.reject(new TypeError('gagal'));
    const error = (await t.session
      .login(SERVER, 'p', '123456')
      .catch((e: unknown) => e)) as ApiProblem;
    expect(error).toBeInstanceOf(ApiProblem);
    expect(error.isNetwork).toBe(true);
  });
});

describe('masuk otomatis', () => {
  it('sesi di vault langsung signedIn tanpa request; tanpa sesi signedOut', async () => {
    const withSession = setup(record());
    await withSession.session.init();
    expect(withSession.session.getState()).toMatchObject({ status: 'signedIn' });
    expect(withSession.calls).toHaveLength(0);

    const empty = setup();
    await empty.session.init();
    expect(empty.session.getState()).toEqual({ status: 'signedOut' });
  });

  it('isi vault rusak atau penyimpanan gagal dianggap tidak ada sesi', async () => {
    const corrupt = setup();
    corrupt.store.data.set('session', '{bukan json');
    await corrupt.session.init();
    expect(corrupt.session.getState().status).toBe('signedOut');

    const incomplete = setup();
    incomplete.store.data.set('session', JSON.stringify({ serverUrl: SERVER }));
    await incomplete.session.init();
    expect(incomplete.session.getState().status).toBe('signedOut');

    const broken = setup();
    broken.store.fail = true;
    await broken.session.init();
    expect(broken.session.getState().status).toBe('signedOut');
  });

  it('token kedaluwarsa saat dibuka diperbarui otomatis dan disimpan', async () => {
    const t = setup(record({ accessExpiresAt: NOW - 1000 }));
    t.handlers['/auth/refresh'] = () => tokens('access-2', 'refresh-2');

    await t.session.init();

    expect(t.session.getState()).toMatchObject({
      status: 'signedIn',
      session: { accessToken: 'access-2', refreshToken: 'refresh-2' },
    });
    expect(JSON.parse(t.store.data.get('session') ?? '{}')).toMatchObject({
      refreshToken: 'refresh-2',
    });
    expect(t.callsTo('/auth/refresh')[0]!.body).toEqual({ refreshToken: 'refresh-1' });
  });

  it('refresh gagal karena jaringan tidak mengeluarkan pengguna', async () => {
    const t = setup(record({ accessExpiresAt: NOW - 1000 }));
    t.handlers['/auth/refresh'] = () => Promise.reject(new TypeError('offline'));

    await t.session.init();

    expect(t.session.getState().status).toBe('signedIn');
    expect(t.store.data.has('session')).toBe(true);
  });

  it('refresh token ditolak mengakhiri sesi: vault dibersihkan dan alasannya expired', async () => {
    const t = setup(record({ accessExpiresAt: NOW - 1000 }));
    t.handlers['/auth/refresh'] = () => problem(401, 'refresh_token_expired');

    await t.session.init();

    expect(t.session.getState()).toEqual({ status: 'signedOut', reason: 'expired' });
    expect(t.store.data.size).toBe(0);
  });
});

describe('refresh token', () => {
  it('banyak permintaan bersamaan dengan token hampir habis hanya memicu satu refresh', async () => {
    const t = setup(record({ accessExpiresAt: NOW + REFRESH_SKEW_MS - 1 }));
    await t.session.init();
    t.calls.length = 0;
    t.handlers['/auth/refresh'] = async () => {
      await new Promise((r) => setTimeout(r, 100));
      return tokens('access-2', 'refresh-2');
    };

    const results = Promise.all(Array.from({ length: 8 }, () => t.session.validAccessToken()));
    await vi.advanceTimersByTimeAsync(150);

    expect(await results).toEqual(Array<string>(8).fill('access-2'));
    expect(t.callsTo('/auth/refresh')).toHaveLength(1);
  });

  it('token yang masih berlaku dipakai apa adanya', async () => {
    const t = setup(record());
    await t.session.init();
    expect(await t.session.validAccessToken()).toBe('access-1');
    expect(t.calls).toHaveLength(0);
  });

  it('401 dari server: refresh sekali lalu request diulang dengan token baru', async () => {
    const t = setup(record());
    await t.session.init();
    t.handlers['/schedules'] = (call) =>
      call.auth === 'Bearer access-2' ? json(200, { items: [] }) : problem(401, 'token_expired');
    t.handlers['/auth/refresh'] = () => tokens('access-2', 'refresh-2');

    expect(await t.session.authedFetch('/schedules')).toEqual({ items: [] });

    expect(t.callsTo('/schedules').map((c) => c.auth)).toEqual([
      'Bearer access-1',
      'Bearer access-2',
    ]);
    expect(t.callsTo('/auth/refresh')).toHaveLength(1);
  });

  it('401 yang bertahan setelah refresh tidak berputar tanpa akhir', async () => {
    const t = setup(record());
    await t.session.init();
    t.handlers['/schedules'] = () => problem(401, 'token_expired');
    t.handlers['/auth/refresh'] = () => tokens('access-2', 'refresh-2');

    await expect(t.session.authedFetch('/schedules')).rejects.toMatchObject({ status: 401 });
    expect(t.callsTo('/schedules')).toHaveLength(2);
  });

  it('Bearer dipasang hanya pada request terautentikasi', async () => {
    const t = setup(record());
    await t.session.init();
    t.handlers['/roles'] = () => json(200, { items: [] });
    await t.session.authedFetch('/roles');
    expect(t.callsTo('/roles')[0]!.auth).toBe('Bearer access-1');
  });

  it('pembaruan proaktif terjadwal sebelum token habis', async () => {
    const t = setup(record({ accessExpiresAt: NOW + 120_000 }));
    t.handlers['/auth/refresh'] = () => tokens('access-2', 'refresh-2');
    await t.session.init();
    expect(t.callsTo('/auth/refresh')).toHaveLength(0);

    t.advance(100_000);
    await vi.advanceTimersByTimeAsync(61_000);

    expect(t.callsTo('/auth/refresh')).toHaveLength(1);
  });
});

describe('logout dan vault', () => {
  it('mencabut token di server lalu menghapus vault', async () => {
    const t = setup(record());
    await t.session.init();
    t.handlers['/auth/logout'] = () => json(204, null);

    await t.session.logout();

    expect(t.callsTo('/auth/logout')[0]!.auth).toBe('Bearer access-1');
    expect(t.session.getState()).toEqual({ status: 'signedOut' });
    expect(t.store.data.size).toBe(0);
  });

  it('server tidak terjangkau: sesi lokal tetap dihapus', async () => {
    const t = setup(record());
    await t.session.init();
    t.handlers['/auth/logout'] = () => Promise.reject(new TypeError('offline'));

    await t.session.logout();

    expect(t.session.getState().status).toBe('signedOut');
    expect(t.store.data.size).toBe(0);
  });

  it('sesi yang melebihi batas Credential Manager ditolak dengan jelas', async () => {
    const vault = new SessionVault(new MemoryStore());
    await expect(vault.save(record({ accessToken: 'x'.repeat(MAX_SECRET_BYTES) }))).rejects.toThrow(
      /terlalu besar/,
    );
  });
});
