import type { WorkerStatus } from '@aios/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WsHandlers, WsOpen } from '../realtime/client';
import { LocalWorkerClient, WorkerCallError, defaultLocalBackoff } from './localClient';

const STATUS: WorkerStatus = {
  gateway: 'connected',
  deviceId: null,
  activeRuns: 0,
  version: '0.1.0',
  ompVersion: null,
  browserAvailable: false,
};

/** Worker palsu yang menjalankan protokol lokal: hello berantai, permintaan/balasan, dorongan. */
class FakeWorker {
  chain = 0;
  token = 'awal-awal-awal-awal';
  alive = true;
  opens = 0;
  hellos: string[] = [];
  handlers: WsHandlers | undefined;
  handle: (
    method: string,
    params: unknown,
  ) => { ok: true; result: unknown } | { ok: false; code: string; message: string } = () => ({
    ok: true,
    result: {},
  });
  swallowReady = false;
  /** Permintaan tidak pernah dijawab. */
  silent = false;

  open: WsOpen = (_url, _headers, handlers) => {
    this.opens++;
    if (!this.alive) return Promise.reject(new Error('ECONNREFUSED'));
    this.handlers = handlers;
    queueMicrotask(() => handlers.onOpen());
    return Promise.resolve({
      send: (text: string) => this.receive(text, handlers),
      close: () => handlers.onClose(1000),
    });
  };

  private receive(text: string, handlers: WsHandlers) {
    const message = JSON.parse(text) as {
      type?: string;
      token?: string;
      id?: string;
      method?: string;
      params?: unknown;
    };
    if (message.type === 'hello') {
      this.hellos.push(message.token ?? '');
      if (message.token !== this.token) {
        queueMicrotask(() => handlers.onClose(4401));
        return;
      }
      this.token = `token-${++this.chain}-${'x'.repeat(20)}`;
      if (this.swallowReady) return;
      queueMicrotask(() => {
        handlers.onMessage(JSON.stringify({ type: 'ready', version: 1, nextToken: this.token }));
        handlers.onMessage(JSON.stringify({ push: 'status', status: STATUS }));
      });
      return;
    }
    if (this.silent) return;
    const outcome = this.handle(message.method ?? '', message.params);
    queueMicrotask(() =>
      handlers.onMessage(
        JSON.stringify(
          outcome.ok
            ? { id: message.id, ok: true, result: outcome.result }
            : {
                id: message.id,
                ok: false,
                error: { code: outcome.code, message: outcome.message },
              },
        ),
      ),
    );
  }

  push(value: object) {
    this.handlers?.onMessage(JSON.stringify(value));
  }
  drop() {
    this.handlers?.onClose(1006);
  }
}

async function until(check: () => boolean, label: string, ms = 2000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error(`timeout menunggu ${label}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

let clients: LocalWorkerClient[] = [];
afterEach(() => {
  clients.forEach((c) => c.stop());
  clients = [];
});

function make(
  worker: FakeWorker,
  over: Partial<ConstructorParameters<typeof LocalWorkerClient>[0]> = {},
) {
  const connectInfo = vi
    .fn()
    .mockImplementation(() => Promise.resolve({ port: 5555, token: worker.token }));
  const client = new LocalWorkerClient({
    connectInfo,
    open: worker.open,
    backoffMs: () => 10,
    ...over,
  });
  clients.push(client);
  return { client, connectInfo };
}

describe('LocalWorkerClient', () => {
  it('menyambung dengan token dari Tauri, menjadi connected, dan menyimpan status dari worker', async () => {
    const worker = new FakeWorker();
    const { client, connectInfo } = make(worker);

    client.start();
    expect(client.getSnapshot().local).toBe('connecting');
    await until(
      () => client.getSnapshot().local === 'connected' && client.getSnapshot().status !== null,
      'connected',
    );

    expect(connectInfo).toHaveBeenCalledTimes(1);
    expect(worker.hellos).toEqual(['awal-awal-awal-awal']);
    expect(client.getSnapshot().status).toEqual(STATUS);
  });

  it('call mengirim permintaan dan mengembalikan hasil; galat worker menjadi WorkerCallError dengan kode', async () => {
    const worker = new FakeWorker();
    worker.handle = (method) =>
      method === 'folders.list'
        ? { ok: true, result: { folders: ['C:\\kerja'] } }
        : { ok: false, code: 'path_not_allowed', message: 'Belum diizinkan.' };
    const { client } = make(worker);
    client.start();
    await until(() => client.getSnapshot().local === 'connected', 'connected');

    expect(await client.call('folders.list')).toEqual({ folders: ['C:\\kerja'] });
    await expect(client.call('project.inspect', { path: 'C:\\x' })).rejects.toMatchObject({
      name: 'WorkerCallError',
      code: 'path_not_allowed',
      message: 'Belum diizinkan.',
    });
  });

  it('call sebelum tersambung ditolak not_connected', async () => {
    const { client } = make(new FakeWorker());
    await expect(client.call('status.get')).rejects.toMatchObject({ code: 'not_connected' });
  });

  it('putus lalu sambung ulang memakai token berantai, tanpa memulai ulang worker', async () => {
    const worker = new FakeWorker();
    const { client, connectInfo } = make(worker);
    client.start();
    await until(() => client.getSnapshot().local === 'connected', 'connected');

    worker.drop();
    expect(client.getSnapshot().local).toBe('reconnecting');
    await until(() => client.getSnapshot().local === 'connected', 'tersambung ulang');

    expect(worker.hellos).toHaveLength(2);
    expect(worker.hellos[1]).toMatch(/^token-1-/);
    expect(connectInfo).toHaveBeenCalledTimes(1);
  });

  it('permintaan yang sedang berjalan saat putus ditolak connection_lost', async () => {
    const worker = new FakeWorker();
    const { client } = make(worker);
    client.start();
    await until(() => client.getSnapshot().local === 'connected', 'connected');
    worker.silent = true;

    const call = client.call('status.get');
    worker.drop();

    await expect(call).rejects.toMatchObject({ code: 'connection_lost' });
  });

  it('rantai token putus (ready tidak sampai): meminta worker dan token baru dari Tauri', async () => {
    const worker = new FakeWorker();
    worker.swallowReady = true;
    const { client, connectInfo } = make(worker, { helloTimeoutMs: 30 });
    client.start();
    await until(
      () => connectInfo.mock.calls.length === 1 && worker.hellos.length === 1,
      'hello pertama',
    );

    worker.swallowReady = false;
    // Worker "dimulai ulang" oleh Tauri: token awal baru.
    worker.token = 'baru-baru-baru-baru-baru';
    await until(() => client.getSnapshot().local === 'connected', 'pulih');

    expect(connectInfo.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(worker.hellos.at(-1)).toBe('baru-baru-baru-baru-baru');
  });

  it('worker mati (koneksi ditolak): terus mencoba dan pulih saat worker hidup lagi', async () => {
    const worker = new FakeWorker();
    worker.alive = false;
    const { client, connectInfo } = make(worker);

    client.start();
    await until(() => worker.opens >= 3, 'beberapa percobaan');
    expect(client.getSnapshot().local).toBe('reconnecting');

    worker.alive = true;
    await until(() => client.getSnapshot().local === 'connected', 'pulih');
    expect(connectInfo.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('connectInfo gagal (worker tidak ditemukan): reconnecting dan dicoba lagi', async () => {
    const worker = new FakeWorker();
    const connectInfo = vi
      .fn()
      .mockRejectedValueOnce(new Error('worker tidak ditemukan'))
      .mockResolvedValue({ port: 1, token: worker.token });
    const client = new LocalWorkerClient({ connectInfo, open: worker.open, backoffMs: () => 10 });
    clients.push(client);

    client.start();

    await until(() => client.getSnapshot().local === 'connected', 'pulih');
    expect(connectInfo).toHaveBeenCalledTimes(2);
  });

  it('push session.updated dan session.invalid diteruskan ke pendengar', async () => {
    const worker = new FakeWorker();
    const { client } = make(worker);
    const pushes: unknown[] = [];
    client.onPush((p) => pushes.push(p));
    client.start();
    await until(() => client.getSnapshot().local === 'connected', 'connected');

    worker.push({ push: 'session.updated', accessToken: 'a', refreshToken: 'r' });
    worker.push({ push: 'session.invalid' });

    expect(pushes.filter((p) => (p as { push: string }).push !== 'status')).toEqual([
      { push: 'session.updated', accessToken: 'a', refreshToken: 'r' },
      { push: 'session.invalid' },
    ]);
  });

  it('push status memperbarui snapshot', async () => {
    const worker = new FakeWorker();
    const { client } = make(worker);
    client.start();
    await until(() => client.getSnapshot().status !== null, 'status');

    worker.push({ push: 'status', status: { ...STATUS, gateway: 'reconnecting' } });

    expect(client.getSnapshot().status?.gateway).toBe('reconnecting');
  });

  it('stop menghentikan semuanya: off, tidak menyambung lagi, permintaan tertunda ditolak', async () => {
    const worker = new FakeWorker();
    const { client } = make(worker);
    client.start();
    await until(() => client.getSnapshot().local === 'connected', 'connected');
    const opens = worker.opens;

    client.stop();
    await new Promise((r) => setTimeout(r, 60));

    expect(client.getSnapshot()).toEqual({ local: 'off', status: null });
    expect(worker.opens).toBe(opens);
  });

  it('permintaan tanpa jawaban melewati batas waktu', async () => {
    const worker = new FakeWorker();
    const { client } = make(worker, { requestTimeoutMs: 40 });
    client.start();
    await until(() => client.getSnapshot().local === 'connected', 'connected');
    worker.silent = true;

    await expect(client.call('status.get')).rejects.toMatchObject({ code: 'timeout' });
  });

  it('defaultLocalBackoff: 0,5 detik naik dua kali lipat sampai 5 detik', () => {
    expect([1, 2, 3, 4, 5, 6].map(defaultLocalBackoff)).toEqual([
      500, 1000, 2000, 4000, 5000, 5000,
    ]);
  });

  it('WorkerCallError membawa kode', () => {
    expect(new WorkerCallError('timeout', 'x').code).toBe('timeout');
  });
});
