import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { createConnection } from 'node:net';
import { networkInterfaces } from 'node:os';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  LocalPushSchema,
  LocalReadySchema,
  LocalResponseSchema,
  ProjectInspectionSchema,
  type LocalPush,
} from '@aios/contracts';
import { WebSocket } from 'ws';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEVICE, FakeGateway, RUN, fresh, until } from '../testing/fake-gateway.js';
import { startWorker, type RunningWorker } from '../worker.js';
import { LocalServer } from './server.js';

const TOKEN = 'token-awal-1234567890-abcdef';
const PROJECT = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e91';

let base: string;
let worker: RunningWorker;
let gateway: FakeGateway;

beforeEach(async () => {
  base = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'aios-local-')));
  gateway = new FakeGateway();
  await gateway.start();
  worker = await startWorker({
    token: TOKEN,
    dataDir: path.join(base, 'data'),
    forbiddenFolders: [],
  });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await worker.stop();
  await gateway.stop();
  await fs.rm(base, { recursive: true, force: true });
});

/** Klien desktop tiruan: hello, permintaan/balasan, dan dorongan. */
class Client {
  readonly pushes: LocalPush[] = [];
  nextToken = '';
  closeCode: number | undefined;
  private readonly pending = new Map<
    string,
    (r: ReturnType<typeof LocalResponseSchema.parse>) => void
  >();
  private seq = 0;
  private constructor(readonly socket: WebSocket) {
    socket.on('close', (code: number) => {
      this.closeCode = code;
    });
    socket.on('message', (data: Buffer) => {
      const raw = JSON.parse(data.toString('utf8')) as Record<string, unknown>;
      const ready = LocalReadySchema.safeParse(raw);
      if (ready.success) {
        this.nextToken = ready.data.nextToken;
        return;
      }
      const push = LocalPushSchema.safeParse(raw);
      if (push.success) {
        this.pushes.push(push.data);
        return;
      }
      const response = LocalResponseSchema.parse(raw);
      this.pending.get(response.id)?.(response);
      this.pending.delete(response.id);
    });
  }

  static async open(port: number, options: { origin?: string } = {}): Promise<Client> {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`, {
      ...(options.origin ? { origin: options.origin } : {}),
    });
    const client = new Client(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
      socket.once('unexpected-response', (_req, res) =>
        reject(new Error(`HTTP ${res.statusCode}`)),
      );
    });
    return client;
  }

  static async login(port: number, token: string): Promise<Client> {
    const client = await Client.open(port);
    client.socket.send(JSON.stringify({ type: 'hello', token }));
    await until(() => client.nextToken !== '' || client.closeCode !== undefined, 'hello');
    return client;
  }

  async call(
    method: string,
    params?: object,
  ): Promise<ReturnType<typeof LocalResponseSchema.parse>> {
    const id = `r${++this.seq}`;
    const answer = new Promise<ReturnType<typeof LocalResponseSchema.parse>>((resolve) =>
      this.pending.set(id, resolve),
    );
    this.socket.send(JSON.stringify({ id, method, ...(params ? { params } : {}) }));
    return answer;
  }

  close() {
    this.socket.close();
  }
}

describe('token berantai', () => {
  it('hello benar mendapat ready dengan token berikutnya; token lama tidak bisa dipakai lagi', async () => {
    const first = await Client.login(worker.port, TOKEN);
    expect(first.nextToken).toHaveLength(64);
    expect(first.closeCode).toBeUndefined();

    const replay = await Client.login(worker.port, TOKEN);
    expect(replay.closeCode).toBe(4401);
    expect(replay.nextToken).toBe('');

    const second = await Client.login(worker.port, first.nextToken);
    expect(second.nextToken).toHaveLength(64);
    expect(second.nextToken).not.toBe(first.nextToken);
    await until(() => first.closeCode === 4409, 'koneksi lama digantikan');
    second.close();
  });

  it('token salah tidak memutar token berantai, sehingga klien sah tetap bisa masuk', async () => {
    const bad = await Client.login(worker.port, 'salah-salah-salah-salah');
    expect(bad.closeCode).toBe(4401);

    const good = await Client.login(worker.port, TOKEN);
    expect(good.nextToken).toHaveLength(64);
    good.close();
  });

  it('permintaan sebelum hello ditolak (koneksi ditutup), bukan dijalankan', async () => {
    const client = await Client.open(worker.port);

    client.socket.send(JSON.stringify({ id: '1', method: 'folders.list' }));

    await until(() => client.closeCode === 4401, 'ditutup');
  });

  it('koneksi dengan header Origin (halaman web) ditolak 403', async () => {
    await expect(
      Client.open(worker.port, { origin: 'https://situs-jahat.example' }),
    ).rejects.toThrow(/403/);
  });

  it('hanya mendengarkan di loopback: alamat jaringan lain di mesin ini menolak sambungan', async () => {
    const external = Object.values(networkInterfaces())
      .flat()
      .find((i) => i?.family === 'IPv4' && !i.internal)?.address;
    const connect = (host: string) =>
      new Promise<'terhubung' | 'ditolak'>((resolve) => {
        const socket = createConnection({ host, port: worker.port, timeout: 1000 });
        socket.once('connect', () => {
          socket.destroy();
          resolve('terhubung');
        });
        socket.once('error', () => resolve('ditolak'));
        socket.once('timeout', () => {
          socket.destroy();
          resolve('ditolak');
        });
      });

    expect(await connect('127.0.0.1')).toBe('terhubung');
    if (external) expect(await connect(external)).toBe('ditolak');
  });

  it('tidak mengirim hello dalam batas waktu: koneksi ditutup', async () => {
    const server = new LocalServer({
      token: TOKEN,
      handle: () => Promise.resolve({}),
      status: () => ({
        gateway: 'offline',
        deviceId: null,
        activeRuns: 0,
        version: 'x',
        ompVersion: null,
        browserAvailable: false,
      }),
      helloTimeoutMs: 50,
    });
    const port = await server.start();
    const client = await Client.open(port);

    await until(() => client.closeCode === 4401, 'timeout hello');
    await server.close();
  });
});

describe('folder yang diizinkan dan project', () => {
  it('menambah, mendaftar, dan mencabut folder; hasil bertahan di disk', async () => {
    const folder = path.join(base, 'kerja');
    await fs.mkdir(folder);
    const client = await Client.login(worker.port, TOKEN);

    expect(await client.call('folders.list')).toMatchObject({ ok: true, result: { folders: [] } });
    expect(await client.call('folders.add', { path: folder })).toMatchObject({
      ok: true,
      result: { folders: [folder] },
    });
    const saved = JSON.parse(
      await fs.readFile(path.join(base, 'data', 'allowed-folders.json'), 'utf8'),
    ) as {
      folders: string[];
    };
    expect(saved.folders).toEqual([folder]);
    expect(await client.call('folders.remove', { path: folder })).toMatchObject({
      ok: true,
      result: { folders: [] },
    });
    client.close();
  });

  it('galat path dipetakan ke kode stabil: tidak ada, bukan folder, relatif', async () => {
    const client = await Client.login(worker.port, TOKEN);
    await fs.writeFile(path.join(base, 'berkas.txt'), 'x');

    expect(await client.call('folders.add', { path: path.join(base, 'tidak-ada') })).toMatchObject({
      ok: false,
      error: { code: 'path_not_found' },
    });
    expect(await client.call('folders.add', { path: path.join(base, 'berkas.txt') })).toMatchObject(
      {
        ok: false,
        error: { code: 'not_a_directory' },
      },
    );
    expect(await client.call('folders.add', { path: 'relatif' })).toMatchObject({
      ok: false,
      error: { code: 'invalid_request' },
    });
    client.close();
  });

  it('inspeksi project di luar folder izin ditolak path_not_allowed (termasuk ../)', async () => {
    const allowed = path.join(base, 'izin');
    const other = path.join(base, 'lain');
    await fs.mkdir(allowed);
    await fs.mkdir(other);
    const client = await Client.login(worker.port, TOKEN);
    await client.call('folders.add', { path: allowed });

    expect(await client.call('project.inspect', { path: other })).toMatchObject({
      ok: false,
      error: { code: 'path_not_allowed' },
    });
    expect(
      await client.call('project.inspect', { path: `${allowed}${path.sep}..${path.sep}lain` }),
    ).toMatchObject({ ok: false, error: { code: 'path_not_allowed' } });
    client.close();
  });

  it('inspeksi mengembalikan nama, stack, dan git; lalu bind, list, unbind', async () => {
    const allowed = path.join(base, 'izin');
    const app = path.join(allowed, 'aplikasi');
    await fs.mkdir(app, { recursive: true });
    await fs.writeFile(
      path.join(app, 'package.json'),
      JSON.stringify({
        scripts: { dev: 'vite' },
        dependencies: { react: '1' },
        packageManager: 'pnpm@10',
      }),
    );
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: app });
    const client = await Client.login(worker.port, TOKEN);
    await client.call('folders.add', { path: allowed });

    const inspected = await client.call('project.inspect', { path: app });
    expect(inspected.ok).toBe(true);
    const inspection = ProjectInspectionSchema.parse((inspected as { result: unknown }).result);
    expect(inspection).toMatchObject({
      path: app,
      name: 'aplikasi',
      stack: { languages: ['javascript'], frameworks: ['react'], packageManager: 'pnpm' },
      git: { isRepo: true, defaultBranch: 'main' },
    });

    expect(await client.call('project.bind', { projectId: PROJECT, path: app })).toMatchObject({
      ok: true,
      result: { projectId: PROJECT, path: app, available: true },
    });
    expect(await client.call('projects.list')).toMatchObject({
      ok: true,
      result: { projects: [{ projectId: PROJECT, path: app, available: true }] },
    });
    expect(await client.call('project.unbind', { projectId: PROJECT })).toMatchObject({
      ok: true,
      result: { projects: [] },
    });
    client.close();
  });

  it('permintaan tidak valid dijawab invalid_request dengan id yang sama', async () => {
    const client = await Client.login(worker.port, TOKEN);

    const answer = await client.call('metode.tidak.ada');

    expect(answer).toMatchObject({ ok: false, error: { code: 'invalid_request' } });
    client.close();
  });

  it('proses anak hanya boleh berjalan di folder yang diizinkan', async () => {
    const allowed = path.join(base, 'izin');
    await fs.mkdir(allowed);
    const client = await Client.login(worker.port, TOKEN);
    await client.call('folders.add', { path: allowed });

    const ok = await worker.processes.run(process.execPath, ['-e', '0'], { cwd: allowed });
    await expect(
      worker.processes.run(process.execPath, ['-e', '0'], { cwd: base }),
    ).rejects.toMatchObject({ code: 'path_not_allowed' });

    expect(ok.code).toBe(0);
    client.close();
  });
});

describe('sesi gateway lewat worker', () => {
  const sessionParams = () => ({
    serverUrl: gateway.url,
    accessToken: fresh(),
    refreshToken: 'refresh-1',
    deviceId: DEVICE,
  });

  it('session.set menyambungkan worker ke gateway dan status didorong ke desktop', async () => {
    const client = await Client.login(worker.port, TOKEN);

    expect(await client.call('session.set', sessionParams())).toMatchObject({ ok: true });

    await until(
      () => client.pushes.some((p) => p.push === 'status' && p.status.gateway === 'connected'),
      'status connected',
    );
    expect(await client.call('status.get')).toMatchObject({
      ok: true,
      result: { gateway: 'connected', deviceId: DEVICE, version: '0.1.0' },
    });
    client.close();
  });

  it('run.start untuk project yang belum terikat dijawab error project_not_bound ke gateway', async () => {
    const client = await Client.login(worker.port, TOKEN);
    await client.call('session.set', sessionParams());
    await until(() => worker.link.state === 'connected', 'connected');

    gateway.last.socket.send(
      JSON.stringify({
        type: 'run.start',
        runId: RUN,
        projectId: PROJECT,
        prompt: 'halo',
        bundle: { role: 'frontend', systemPrompt: 'x' },
        model: 'combo/code',
      }),
    );

    await until(() => gateway.received.length >= 1, 'event error');
    expect(gateway.received).toEqual([
      {
        type: 'run.event',
        runId: RUN,
        event: expect.objectContaining({ type: 'error', code: 'project_not_bound' }) as unknown,
      },
    ]);
    client.close();
  });

  it('review.* lokal: hasil yang tidak ada dijawab review_not_found; parameter salah invalid_request', async () => {
    const client = await Client.login(worker.port, TOKEN);

    expect(await client.call('review.get', { runId: RUN })).toMatchObject({
      ok: false,
      error: { code: 'review_not_found' },
    });
    expect(await client.call('review.undo', { runId: RUN, checkpointId: 'base' })).toMatchObject({
      ok: false,
      error: { code: 'review_not_found' },
    });
    expect(await client.call('review.revertFile', { runId: RUN, path: 'a.txt' })).toMatchObject({
      ok: false,
      error: { code: 'review_not_found' },
    });
    expect(await client.call('review.get', { runId: 'bukan-id' })).toMatchObject({
      ok: false,
      error: { code: 'invalid_request' },
    });
    client.close();
  });

  it('files.* lokal: project terikat bisa dijelajahi; di luar folder dan project belum terikat ditolak', async () => {
    const allowed = path.join(base, 'izin');
    const app = path.join(allowed, 'aplikasi');
    await fs.mkdir(path.join(app, 'src'), { recursive: true });
    await fs.writeFile(path.join(app, 'src', 'main.ts'), 'export {};\n');
    await fs.writeFile(path.join(allowed, 'luar.txt'), 'rahasia');
    const client = await Client.login(worker.port, TOKEN);
    await client.call('folders.add', { path: allowed });

    expect(await client.call('files.list', { projectId: PROJECT })).toMatchObject({
      ok: false,
      error: { code: 'preview_unavailable' },
    });

    await client.call('project.bind', { projectId: PROJECT, path: app });
    expect(await client.call('files.list', { projectId: PROJECT })).toMatchObject({
      ok: true,
      result: { path: '', entries: [{ name: 'src', kind: 'dir' }] },
    });
    expect(
      await client.call('files.read', { projectId: PROJECT, path: 'src/main.ts' }),
    ).toMatchObject({ ok: true, result: { kind: 'text', content: 'export {};\n' } });
    expect(await client.call('files.find', { projectId: PROJECT, query: 'main' })).toMatchObject({
      ok: true,
      result: { paths: ['src/main.ts'] },
    });
    expect(
      await client.call('files.read', { projectId: PROJECT, path: '../luar.txt' }),
    ).toMatchObject({ ok: false, error: { code: 'path_not_allowed' } });
    client.close();
  });

  it('git.* lokal: status, diff, dan log project terikat; project belum terikat dan path keluar ditolak', async () => {
    const allowed = path.join(base, 'izin');
    const app = path.join(allowed, 'repo');
    await fs.mkdir(path.join(app, 'src'), { recursive: true });
    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'user.name=Uji', '-c', 'user.email=uji@example.com', ...args], {
        cwd: app,
      });
    git('init', '-q', '-b', 'main');
    await fs.writeFile(path.join(app, 'src', 'a.ts'), 'export const a = 1;\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'feat: awal');
    await fs.writeFile(path.join(app, 'src', 'a.ts'), 'export const a = 2;\n');
    const client = await Client.login(worker.port, TOKEN);
    await client.call('folders.add', { path: allowed });

    expect(await client.call('git.status', { projectId: PROJECT })).toMatchObject({
      ok: false,
      error: { code: 'preview_unavailable' },
    });

    await client.call('project.bind', { projectId: PROJECT, path: app });
    expect(await client.call('git.status', { projectId: PROJECT })).toMatchObject({
      ok: true,
      result: { isRepo: true, branch: 'main', files: [{ path: 'src/a.ts', status: 'modified' }] },
    });
    const diff = await client.call('git.diff', { projectId: PROJECT, path: 'src/a.ts' });
    expect(diff).toMatchObject({ ok: true });
    expect(JSON.stringify(diff)).toContain('+export const a = 2;');
    expect(await client.call('git.log', { projectId: PROJECT })).toMatchObject({
      ok: true,
      result: { commits: [{ subject: 'feat: awal' }] },
    });
    expect(
      await client.call('git.diff', { projectId: PROJECT, path: '../luar.txt' }),
    ).toMatchObject({ ok: false, error: { code: 'path_not_allowed' } });
    client.close();
  });

  it('aksi git lokal: stage lalu commit berhasil; commit tanpa stage git_failed; project belum terikat ditolak', async () => {
    const allowed = path.join(base, 'izin');
    const app = path.join(allowed, 'repo-aksi');
    await fs.mkdir(app, { recursive: true });
    // Commit lewat layanan worker memakai identitas dari lingkungan (runner CI tidak punya konfigurasi global).
    vi.stubEnv('GIT_AUTHOR_NAME', 'Uji');
    vi.stubEnv('GIT_AUTHOR_EMAIL', 'uji@example.com');
    vi.stubEnv('GIT_COMMITTER_NAME', 'Uji');
    vi.stubEnv('GIT_COMMITTER_EMAIL', 'uji@example.com');
    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'user.name=Uji', '-c', 'user.email=uji@example.com', ...args], {
        cwd: app,
      });
    git('init', '-q', '-b', 'main');
    await fs.writeFile(path.join(app, 'a.txt'), 'satu\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'feat: awal');
    await fs.writeFile(path.join(app, 'a.txt'), 'dua\n');
    const client = await Client.login(worker.port, TOKEN);
    await client.call('folders.add', { path: allowed });

    expect(await client.call('git.stage', { projectId: PROJECT, all: true })).toMatchObject({
      ok: false,
      error: { code: 'preview_unavailable' },
    });

    await client.call('project.bind', { projectId: PROJECT, path: app });
    expect(
      await client.call('git.commit', { projectId: PROJECT, message: 'fix: dua' }),
    ).toMatchObject({ ok: false, error: { code: 'git_failed' } });
    expect(await client.call('git.stage', { projectId: PROJECT, all: true })).toMatchObject({
      ok: true,
    });
    expect(
      await client.call('git.commit', { projectId: PROJECT, message: 'fix: dua' }),
    ).toMatchObject({ ok: true, result: { subject: 'fix: dua' } });
    expect(await client.call('git.branches', { projectId: PROJECT })).toMatchObject({
      ok: true,
      result: { current: 'main', branches: ['main'] },
    });
    client.close();
  });

  it('preview.* lokal: belum ada preview dijawab null; project belum terikat dan worktree hilang preview_unavailable', async () => {
    const client = await Client.login(worker.port, TOKEN);

    expect(await client.call('preview.get', { projectId: PROJECT })).toMatchObject({
      ok: true,
      result: null,
    });
    expect(await client.call('preview.start', { projectId: PROJECT })).toMatchObject({
      ok: false,
      error: { code: 'preview_unavailable' },
    });
    expect(await client.call('preview.shot', { projectId: PROJECT })).toMatchObject({
      ok: false,
      error: { code: 'preview_unavailable' },
    });
    expect(await client.call('preview.stop', { projectId: PROJECT })).toMatchObject({ ok: true });
    expect(await client.call('preview.start', { projectId: 'bukan-id' })).toMatchObject({
      ok: false,
      error: { code: 'invalid_request' },
    });
    client.close();
  });

  it('review.apply dari gateway dijawab frame review.result; menolak hasil yang sudah tidak ada tetap berhasil', async () => {
    const client = await Client.login(worker.port, TOKEN);
    await client.call('session.set', sessionParams());
    await until(() => worker.link.state === 'connected', 'connected');

    gateway.last.socket.send(
      JSON.stringify({
        type: 'review.apply',
        runId: RUN,
        decision: 'reject',
        comments: [],
        merge: false,
      }),
    );
    await until(() => gateway.received.length >= 1, 'review.result reject');
    gateway.last.socket.send(
      JSON.stringify({
        type: 'review.apply',
        runId: RUN,
        decision: 'accept',
        comments: [],
        merge: false,
      }),
    );
    await until(() => gateway.received.length >= 2, 'review.result accept');

    expect(gateway.received[0]).toMatchObject({
      type: 'review.result',
      runId: RUN,
      decision: 'reject',
      ok: true,
    });
    expect(gateway.received[1]).toMatchObject({
      type: 'review.result',
      runId: RUN,
      decision: 'accept',
      ok: false,
      error: expect.stringContaining('sudah tidak ada') as unknown,
    });
    client.close();
  });

  it('token dirotasi: desktop menerima session.updated dengan refresh token baru', async () => {
    const newAccess = fresh();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ accessToken: newAccess, refreshToken: 'refresh-2', expiresIn: 900 }),
          ),
        ),
    );
    const client = await Client.login(worker.port, TOKEN);
    await client.call('session.set', sessionParams());
    await until(() => worker.link.state === 'connected', 'connected');

    gateway.last.socket.close(4401, 'token_expired');

    await until(() => client.pushes.some((p) => p.push === 'session.updated'), 'session.updated');
    expect(client.pushes.find((p) => p.push === 'session.updated')).toEqual({
      push: 'session.updated',
      accessToken: newAccess,
      refreshToken: 'refresh-2',
    });
    vi.unstubAllGlobals();
    client.close();
  });

  it('refresh ditolak: desktop menerima session.invalid dan status offline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    const client = await Client.login(worker.port, TOKEN);
    await client.call('session.set', sessionParams());
    await until(() => worker.link.state === 'connected', 'connected');

    gateway.last.socket.close(4401, 'device_revoked');

    await until(() => client.pushes.some((p) => p.push === 'session.invalid'), 'session.invalid');
    expect(worker.link.state).toBe('offline');
    vi.unstubAllGlobals();
    client.close();
  });

  it('session.clear memutus gateway', async () => {
    const client = await Client.login(worker.port, TOKEN);
    await client.call('session.set', sessionParams());
    await until(() => worker.link.state === 'connected', 'connected');

    await client.call('session.clear');

    expect(worker.link.state).toBe('offline');
    client.close();
  });

  it('stop() mematikan proses anak dan koneksi', async () => {
    const allowed = path.join(base, 'izin');
    await fs.mkdir(allowed);
    const client = await Client.login(worker.port, TOKEN);
    await client.call('folders.add', { path: allowed });
    const running = worker.processes.run(process.execPath, ['-e', 'setTimeout(()=>{},30000)'], {
      cwd: allowed,
      timeoutMs: 60_000,
    });
    await until(() => worker.processes.running === 1, 'proses berjalan');

    await worker.stop();

    expect((await running).code).not.toBe(0);
    expect(worker.processes.running).toBe(0);
    // afterEach memanggil stop() lagi: harus aman dipanggil dua kali.
  });
});
