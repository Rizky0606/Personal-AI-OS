import type { LocalPush, WorkerStatus } from '@aios/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkerRegistration } from '../api/gateway';
import type { AuthState } from '../auth/authSession';
import type { SecretStore } from '../auth/secretStore';
import type { WorkerSnapshot } from './localClient';
import { WorkerService } from './workerService';
import { WorkerVault } from './workerVault';

const DEVICE = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';
const SERVER = 'https://aios.contoh.com';

class MemoryStore implements SecretStore {
  data = new Map<string, string>();
  get = (key: string) => Promise.resolve(this.data.get(key) ?? null);
  set = (key: string, value: string) => {
    this.data.set(key, value);
    return Promise.resolve();
  };
  remove = (key: string) => {
    this.data.delete(key);
    return Promise.resolve();
  };
}

const status = (over: Partial<WorkerStatus> = {}): WorkerStatus => ({
  gateway: 'offline',
  deviceId: null,
  activeRuns: 0,
  version: '0.1.0',
  ompVersion: null,
  browserAvailable: false,
  ...over,
});

function setup(initial: { auth?: AuthState; snapshot?: WorkerSnapshot } = {}) {
  const store = new MemoryStore();
  const vault = new WorkerVault(store);
  let auth: AuthState = initial.auth ?? {
    status: 'signedIn',
    session: {
      serverUrl: SERVER,
      accessToken: 'a',
      refreshToken: 'r',
      accessExpiresAt: 0,
      deviceId: 'd',
      deviceName: 'PC Rizky',
    },
  };
  let snapshot: WorkerSnapshot = initial.snapshot ?? { local: 'connected', status: status() };
  const clientListeners = new Set<() => void>();
  const authListeners = new Set<() => void>();
  const pushListeners = new Set<(p: LocalPush) => void>();
  const call = vi.fn().mockResolvedValue({});
  const register = vi.fn<(name: string) => Promise<WorkerRegistration>>().mockResolvedValue({
    accessToken: 'worker-access',
    refreshToken: 'worker-refresh',
    expiresIn: 900,
    device: {
      id: DEVICE,
      kind: 'worker',
      name: 'PC Rizky worker',
      scopes: ['worker', 'llm'],
      lastSeenAt: null,
      createdAt: '2026-10-22T06:38:00Z',
    },
  });
  const service = new WorkerService({
    client: {
      getSnapshot: () => snapshot,
      subscribe: (l) => (clientListeners.add(l), () => clientListeners.delete(l)),
      call,
      onPush: (l) => (pushListeners.add(l), () => pushListeners.delete(l)),
    },
    auth: {
      getState: () => auth,
      subscribe: (l) => (authListeners.add(l), () => authListeners.delete(l)),
    },
    vault,
    register,
    retryMs: 30,
  });
  return {
    service,
    store,
    vault,
    call,
    register,
    setSnapshot(next: WorkerSnapshot) {
      snapshot = next;
      clientListeners.forEach((l) => l());
    },
    setAuth(next: AuthState) {
      auth = next;
      authListeners.forEach((l) => l());
    },
    push: (p: LocalPush) => pushListeners.forEach((l) => l(p)),
  };
}

const flush = () => new Promise((r) => setTimeout(r, 20));
let current: WorkerService | undefined;
afterEach(() => current?.stop());

describe('WorkerService', () => {
  it('login pertama: mendaftarkan worker otomatis, menyimpannya, lalu memberikan sesi ke worker', async () => {
    const t = setup();
    current = t.service;

    t.service.start();
    await flush();

    expect(t.register).toHaveBeenCalledWith('PC Rizky worker');
    expect(await t.vault.load()).toEqual({
      serverUrl: SERVER,
      deviceId: DEVICE,
      accessToken: 'worker-access',
      refreshToken: 'worker-refresh',
    });
    expect(t.call).toHaveBeenCalledWith('session.set', {
      serverUrl: SERVER,
      deviceId: DEVICE,
      accessToken: 'worker-access',
      refreshToken: 'worker-refresh',
    });
  });

  it('kredensial sudah ada: dipakai ulang tanpa mendaftar lagi', async () => {
    const t = setup();
    current = t.service;
    await t.vault.save({
      serverUrl: SERVER,
      deviceId: DEVICE,
      accessToken: 'tersimpan-a',
      refreshToken: 'tersimpan-r',
    });

    t.service.start();
    await flush();

    expect(t.register).not.toHaveBeenCalled();
    expect(t.call).toHaveBeenCalledWith(
      'session.set',
      expect.objectContaining({ refreshToken: 'tersimpan-r' }),
    );
  });

  it('server berganti: kredensial lama dibuang dan worker didaftarkan ulang', async () => {
    const t = setup();
    current = t.service;
    await t.vault.save({
      serverUrl: 'https://server-lain.example',
      deviceId: DEVICE,
      accessToken: 'x',
      refreshToken: 'y',
    });

    t.service.start();
    await flush();

    expect(t.register).toHaveBeenCalledTimes(1);
  });

  it('tidak berbuat apa-apa sebelum worker tersambung atau bila sudah punya sesi gateway', async () => {
    const waiting = setup({ snapshot: { local: 'connecting', status: null } });
    const hasSession = setup({
      snapshot: { local: 'connected', status: status({ deviceId: DEVICE, gateway: 'connected' }) },
    });
    current = waiting.service;

    waiting.service.start();
    hasSession.service.start();
    await flush();
    hasSession.service.stop();

    expect(waiting.register).not.toHaveBeenCalled();
    expect(waiting.call).not.toHaveBeenCalled();
    expect(hasSession.call).not.toHaveBeenCalled();
  });

  it('worker (baru) tersambung belakangan: sesi diberikan saat itu juga', async () => {
    const t = setup({ snapshot: { local: 'reconnecting', status: null } });
    current = t.service;
    t.service.start();
    await flush();
    expect(t.call).not.toHaveBeenCalled();

    t.setSnapshot({ local: 'connected', status: status() });
    await flush();

    expect(t.call).toHaveBeenCalledWith('session.set', expect.anything());
  });

  it('refresh token dirotasi worker: salinan baru disimpan ke Credential Manager', async () => {
    const t = setup();
    current = t.service;
    t.service.start();
    await flush();

    t.push({ push: 'session.updated', accessToken: 'akses-baru', refreshToken: 'refresh-baru' });
    await flush();

    expect(await t.vault.load()).toMatchObject({
      deviceId: DEVICE,
      accessToken: 'akses-baru',
      refreshToken: 'refresh-baru',
    });
  });

  it('session.invalid: kredensial dibuang lalu worker didaftarkan ulang (dengan jeda)', async () => {
    const t = setup();
    current = t.service;
    t.service.start();
    await flush();
    expect(t.register).toHaveBeenCalledTimes(1);

    t.push({ push: 'session.invalid' });
    t.setSnapshot({ local: 'connected', status: status() });
    await flush();
    await new Promise((r) => setTimeout(r, 60));

    expect(t.register).toHaveBeenCalledTimes(2);
  });

  it('gagal mendaftar (mis. server mati): mencoba lagi setelah jeda, tidak menyimpan setengah jadi', async () => {
    const t = setup();
    current = t.service;
    t.register.mockRejectedValueOnce(new Error('jaringan'));

    t.service.start();
    await flush();
    expect(await t.vault.load()).toBeNull();
    expect(t.call).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 80));

    expect(t.register).toHaveBeenCalledTimes(2);
    expect(t.call).toHaveBeenCalledWith('session.set', expect.anything());
  });

  it('keluar dari akun: worker diminta melepas sesi dan kredensial dihapus', async () => {
    const t = setup();
    current = t.service;
    t.service.start();
    await flush();
    t.call.mockClear();

    t.setAuth({ status: 'signedOut' });
    await flush();

    expect(t.call).toHaveBeenCalledWith('session.clear');
    expect(await t.vault.load()).toBeNull();
  });
});
