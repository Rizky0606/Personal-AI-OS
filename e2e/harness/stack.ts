import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { createServer as createNetServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import {
  createAuthEnv,
  OWNER_PASSWORD,
  type AuthEnv,
} from '../../apps/gateway/src/testing/auth-env.js';
import { resolveOmp } from '../../apps/worker/src/runs/omp-path.js';
import { startWorker, type RunningWorker } from '../../apps/worker/src/worker.js';
import { startFakes, type Fakes } from './fakes.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export interface Stack {
  /** Alamat server kendali (HTTP + WebSocket bridge) yang dipakai shim Tauri di halaman. */
  controlUrl: string;
  gatewayUrl: string;
  fakes: Fakes;
  stop(): Promise<void>;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      server.close(() => resolve(port));
    });
  });
}

function startPostgres(dir: string, port: number): Promise<ChildProcess> {
  const script = path.join(root, 'apps/gateway/src/testing/embedded-pg.mjs');
  const child = spawn(process.execPath, [script, dir, String(port)], {
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Postgres tertanam tidak siap dalam 120 detik.'));
    }, 120_000);
    child.once('exit', (code) =>
      reject(new Error(`Postgres tertanam berhenti (kode ${String(code)}).`)),
    );
    child.stdout.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('READY')) {
        clearTimeout(timer);
        child.removeAllListeners('exit');
        resolve(child);
      }
    });
  });
}

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@aios.test', ...args], {
    cwd,
    encoding: 'utf8',
  }).trim();

const cors = (res: ServerResponse) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', '*');
  res.setHeader('access-control-allow-methods', '*');
};

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });

/**
 * Menjalankan seluruh stack E2E dalam satu proses: Postgres tertanam, layanan eksternal palsu, gateway nyata
 * (modul yang sama dengan produksi, lewat perakit tes), worker nyata dengan omp nyata, dan server kendali
 * untuk shim Tauri di halaman.
 */
export async function startStack(): Promise<Stack> {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), 'aios-e2e-')));
  // CI dan beberapa mesin lokal tidak punya ICU lama yang dibutuhkan binary Postgres tertanam
  // (lihat docs/BACKLOG.md); TEST_DATABASE_URL (sama seperti job "check") melewati itu memakai
  // Postgres nyata.
  const externalDbUrl = process.env.TEST_DATABASE_URL;
  let pg: ChildProcess | undefined;
  let databaseUrl: string;
  if (externalDbUrl) {
    databaseUrl = externalDbUrl;
  } else {
    const pgPort = await freePort();
    pg = await startPostgres(path.join(base, 'pg'), pgPort);
    databaseUrl = `postgres://aios:aios-test@127.0.0.1:${pgPort}/postgres`;
  }
  const fakes = await startFakes();

  const env: AuthEnv = await createAuthEnv(databaseUrl, {
    ninerouterUrl: `${fakes.ninerouterUrl}/v1`,
    hermesUrl: fakes.hermesUrl,
    research: { searxngUrl: fakes.searxngUrl },
    schedules: { pollMs: 200 },
    taskMaxParallel: 2,
    rateLimits: { login: 1000 },
  });
  await env.app.listen({ port: 0, host: '127.0.0.1' });
  const gatewayUrl = `http://127.0.0.1:${(env.app.server.address() as AddressInfo).port}`;

  let worker: RunningWorker | undefined;
  const startNewWorker = async () => {
    await worker?.stop().catch(() => undefined);
    const token = randomBytes(24).toString('hex');
    const dataDir = path.join(base, `worker-${randomBytes(3).toString('hex')}`);
    mkdirSync(dataDir, { recursive: true });
    worker = await startWorker({ token, dataDir, forbiddenFolders: [], maxRunMs: 120_000 });
    return { port: worker.port, token };
  };

  const repos: string[] = [];
  const makeRepo = () => {
    const dir = realpathSync(mkdtempSync(path.join(base, 'repo-')));
    git(dir, 'init', '-q', '-b', 'main');
    writeFileSync(path.join(dir, 'README.md'), '# Proyek uji E2E\n');
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'proyek-uji', scripts: { dev: 'node server.js' } }),
    );
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'awal');
    repos.push(dir);
    return dir;
  };

  const http = createHttpServer((req, res) => {
    cors(res);
    if (req.method === 'OPTIONS') return void res.writeHead(204).end();
    const url = new URL(req.url ?? '/', 'http://x');
    const send = (value: unknown) =>
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(value));
    void (async () => {
      try {
        if (url.pathname === '/config') {
          return send({ gatewayUrl, password: OWNER_PASSWORD, hermesAnswer: fakes.hermesAnswer });
        }
        if (url.pathname === '/totp') {
          // Seperti login perangkat baru: satu langkah TOTP maju supaya kode tidak dianggap terpakai ulang.
          env.clock.now += 30_000;
          return send({ code: env.code() });
        }
        if (url.pathname === '/capabilities') {
          return send({
            omp: await resolveOmp().then(
              () => true,
              () => false,
            ),
          });
        }
        if (url.pathname === '/worker/start') return send(await startNewWorker());
        if (url.pathname === '/repo') return send({ path: makeRepo() });
        if (url.pathname === '/git') {
          const body = JSON.parse(await readBody(req)) as { cwd: string; args: string[] };
          const cwd = path.resolve(body.cwd);
          if (!cwd.startsWith(base)) return void res.writeHead(403).end();
          return send({ out: git(cwd, ...body.args) });
        }
        if (url.pathname === '/http') {
          const body = JSON.parse(await readBody(req)) as {
            url: string;
            method: string;
            headers: [string, string][];
            body: string | null;
          };
          const upstream = await fetch(body.url, {
            method: body.method,
            headers: body.headers.filter(
              ([k]) => !['host', 'origin', 'referer'].includes(k.toLowerCase()),
            ),
            ...(body.body === null ? {} : { body: body.body }),
          });
          return send({
            status: upstream.status,
            statusText: upstream.statusText,
            headers: [...upstream.headers.entries()].filter(
              ([k]) => k !== 'content-encoding' && k !== 'content-length',
            ),
            body: await upstream.text(),
          });
        }
        res.writeHead(404).end();
      } catch (error) {
        res.writeHead(500).end(String(error instanceof Error ? error.message : error));
      }
    })();
  });

  // Jembatan WebSocket: halaman membuka soket ke sini; Node membuka soket asli dengan header yang diminta.
  const bridge = new WebSocketServer({ server: http, path: '/bridge' });
  bridge.on('connection', (client, req) => {
    const params = new URL(req.url ?? '', 'http://x').searchParams;
    const upstream = new WebSocket(params.get('url') ?? '', {
      headers: JSON.parse(params.get('headers') ?? '{}') as Record<string, string>,
    });
    const pending: string[] = [];
    upstream.on('open', () => pending.splice(0).forEach((m) => upstream.send(m)));
    upstream.on('message', (data) => client.send((data as Buffer).toString('utf8')));
    upstream.on('close', (code) =>
      client.close(code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 ? code : 1011),
    );
    upstream.on('error', () => client.close(1011));
    client.on('message', (data) => {
      const text = (data as Buffer).toString('utf8');
      if (upstream.readyState === WebSocket.OPEN) upstream.send(text);
      else pending.push(text);
    });
    client.on('close', () => upstream.close());
  });

  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const controlUrl = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;

  return {
    controlUrl,
    gatewayUrl,
    fakes,
    async stop() {
      await worker?.stop().catch(() => undefined);
      bridge.close();
      http.close();
      await env.close().catch(() => undefined);
      await fakes.close();
      if (pg) {
        pg.stdin?.end();
        await new Promise((r) => setTimeout(r, 500));
      }
      try {
        rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
      } catch (err) {
        // Windows kadang masih mengunci berkas Postgres; folder sementara tidak boleh menggagalkan hasil tes.
        console.warn(`[e2e] folder sementara tidak terhapus: ${base} (${String(err)})`);
      }
    },
  };
}
