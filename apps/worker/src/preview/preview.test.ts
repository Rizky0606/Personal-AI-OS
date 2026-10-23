import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { PreviewInfo } from '@aios/contracts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ProcessManager } from '../process/manager.js';
import { BrowserHost, findBrowser } from './browser.js';
import { MCP_SERVER_NAME } from './mcp.js';
import { PreviewService } from './service.js';

const RUN = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';
const PROJECT = '0192f0c4-7a1b-7c2d-a001-4a5b6c7d8e91';
const hasBrowser = findBrowser() !== undefined;

const SERVER_JS = `
const http = require('node:http');
const fs = require('node:fs');
const port = Number(process.env.PORT);
http.createServer((req, res) => {
  const file = req.url === '/style.css' ? 'style.css' : req.url === '/' ? 'index.html' : null;
  if (!file) { res.writeHead(404).end('tidak ada'); return; }
  res.writeHead(200, { 'content-type': file.endsWith('css') ? 'text/css' : 'text/html' });
  res.end(fs.readFileSync(file));
}).listen(port, '127.0.0.1', () => console.log('  Local:   http://localhost:' + port + '/'));
`;

const INDEX_HTML = `<!doctype html><html><head><link rel="stylesheet" href="/style.css"></head>
<body><button id="simpan" class="simpan">Simpan perubahan sekarang juga</button>
<script>console.error('halo dari halaman')</script></body></html>`;

let base: string;
let project: string;
let service: PreviewService;
let processes: ProcessManager;
const states: PreviewInfo[] = [];

/** Menunggu sampai alamat menolak koneksi (taskkill berjalan asinkron). */
async function refused(url: string, ms = 10_000) {
  const start = Date.now();
  for (;;) {
    const alive = await fetch(url, { signal: AbortSignal.timeout(1000) }).then(
      () => true,
      () => false,
    );
    if (!alive) return;
    if (Date.now() - start > ms) throw new Error(`${url} masih menjawab setelah dihentikan`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

interface RpcContent {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
}
interface RpcBody {
  result: {
    content: RpcContent[];
    isError?: boolean;
    tools: { name: string }[];
    serverInfo: { name: string };
  };
}

const textOf = (r: { body: RpcBody }) => r.body.result.content[0]?.text ?? '';
const imageOf = (r: { body: RpcBody }) => {
  const image = r.body.result.content.find((c) => c.type === 'image');
  if (!image) throw new Error('hasil tool tidak berisi gambar');
  return { data: image.data ?? '', mimeType: image.mimeType };
};

const rpc = async (
  reg: { url: string; headers: Record<string, string> },
  method: string,
  params?: object,
) => {
  const res = await fetch(reg.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...reg.headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as RpcBody };
};

beforeAll(async () => {
  base = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'aios-prev-')));
});
afterAll(async () => {
  await fs.rm(base, { recursive: true, force: true });
});

beforeEach(async () => {
  project = path.join(base, `app-${Math.random().toString(36).slice(2, 8)}`);
  await fs.mkdir(project, { recursive: true });
  await fs.writeFile(
    path.join(project, 'package.json'),
    JSON.stringify({ name: 'app', scripts: { dev: 'node server.js' } }),
  );
  await fs.writeFile(path.join(project, 'server.js'), SERVER_JS);
  await fs.writeFile(path.join(project, 'index.html'), INDEX_HTML);
  await fs.writeFile(path.join(project, 'style.css'), '#simpan { width: 600px; }');
  states.length = 0;
  processes = new ProcessManager();
  service = new PreviewService({
    processes,
    resolve: () => Promise.resolve({ cwd: project, projectPath: project }),
    onChange: (info) => states.push(info),
    readyTimeoutMs: 30_000,
  });
});
afterEach(async () => {
  await service.stopAll();
  await processes.killAll();
});

describe('PreviewService: dev server', () => {
  it('mendeteksi skrip dev, menjalankannya, dan menyajikan halaman lewat proxy dengan jembatan', async () => {
    const info = await service.start({ projectId: PROJECT });

    expect(info).toMatchObject({
      status: 'ready',
      command: expect.stringContaining('run dev') as unknown,
      error: null,
    });
    expect(info.devUrl).toMatch(/^http:\/\/localhost:\d+\/$/);
    expect(info.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    const html = await (await fetch(info.url!)).text();
    expect(html).toContain('Simpan perubahan');
    expect(html).toContain('/__aios_bridge.js');
    // Keadaan bergerak: starting lalu ready.
    expect(states.map((s) => s.status)).toEqual(['starting', 'starting', 'ready']);
  }, 60_000);

  it('start berulang mengembalikan preview yang sama; stop mematikan dev server dan proxy', async () => {
    const first = await service.start({ projectId: PROJECT });
    const again = await service.start({ projectId: PROJECT });
    expect(again.url).toBe(first.url);
    expect(service.get({ projectId: PROJECT })?.status).toBe('ready');

    await service.stop({ projectId: PROJECT });

    expect(states.at(-1)?.status).toBe('stopped');
    expect(service.get({ projectId: PROJECT })).toBeUndefined();
    await refused(first.devUrl!);
    await refused(first.url!);
  }, 60_000);

  it('tanpa skrip dev: gagal dengan pesan yang menyebut apa yang harus ditambahkan', async () => {
    await fs.writeFile(
      path.join(project, 'package.json'),
      JSON.stringify({ scripts: { build: 'x' } }),
    );

    const info = await service.start({ projectId: PROJECT });

    expect(info.status).toBe('failed');
    expect(info.error).toContain('skrip dev');
  });

  it('dev server yang langsung mati: gagal dengan log keluarannya', async () => {
    await fs.writeFile(
      path.join(project, 'server.js'),
      `console.log('port dipakai'); process.exit(1);`,
    );

    const info = await service.start({ projectId: PROJECT });

    expect(info.status).toBe('failed');
    expect(info.error).toContain('berhenti sebelum siap');
    expect(info.log).toContain('port dipakai');
  }, 60_000);

  it('preview run di worktree: node_modules proyek ditautkan bila diabaikan git, dan dilepas tanpa menghapus isinya', async () => {
    const { execFileSync } = await import('node:child_process');
    const git = (cwd: string, ...args: string[]) =>
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd });
    await fs.writeFile(path.join(project, '.gitignore'), 'node_modules/\n');
    git(project, 'init', '-q', '-b', 'main');
    git(project, 'add', '-A');
    git(project, 'commit', '-q', '-m', 'awal');
    await fs.mkdir(path.join(project, 'node_modules', 'paket'), { recursive: true });
    await fs.writeFile(path.join(project, 'node_modules', 'paket', 'index.js'), 'x');
    const tree = path.join(base, `tree-${Math.random().toString(36).slice(2, 8)}`);
    git(project, 'worktree', 'add', '-q', '-b', 'aios/uji1', tree);

    const { linkNodeModules, unlinkNodeModules } = await import('./nodemodules.js');
    await linkNodeModules(processes, project, tree);

    expect(await fs.readFile(path.join(tree, 'node_modules', 'paket', 'index.js'), 'utf8')).toBe(
      'x',
    );
    // git menganggapnya diabaikan, jadi tidak ikut ke diff review.
    expect(git(tree, 'status', '--porcelain').toString().trim()).toBe('');

    await unlinkNodeModules(tree);

    await expect(fs.stat(path.join(tree, 'node_modules'))).rejects.toThrow();
    expect(await fs.readFile(path.join(project, 'node_modules', 'paket', 'index.js'), 'utf8')).toBe(
      'x',
    );
  }, 60_000);
});

describe.skipIf(!hasBrowser)('tool browser untuk agent (MCP + Playwright)', () => {
  let host: BrowserHost;
  beforeAll(() => {
    host = new BrowserHost();
  });
  afterAll(async () => {
    await host.close();
  });

  const makeService = () =>
    new PreviewService({
      processes,
      browser: host,
      resolve: () => Promise.resolve({ cwd: project, projectPath: project }),
      onChange: (info) => states.push(info),
      readyTimeoutMs: 30_000,
    });

  it('menolak tanpa token; mengumumkan tool; screenshot ponsel, perbaikan, lalu screenshot kedua berbeda', async () => {
    service = makeService();
    const reg = (await service.registerRun({ projectId: PROJECT, runId: RUN }))!;
    expect(reg.url).toContain(`/mcp/${RUN}`);

    // Tanpa token / token salah ditolak.
    const noAuth = await fetch(reg.url, { method: 'POST', body: '{}' });
    expect(noAuth.status).toBe(401);
    expect(
      (
        await fetch(reg.url, {
          method: 'POST',
          headers: { authorization: 'Bearer salah' },
          body: '{}',
        })
      ).status,
    ).toBe(401);

    const init = await rpc(reg, 'initialize', { protocolVersion: '2025-03-26' });
    expect(init.body.result.serverInfo.name).toBe(MCP_SERVER_NAME);
    const list = await rpc(reg, 'tools/list');
    expect(list.body.result.tools.map((t: { name: string }) => t.name)).toEqual([
      'browser_screenshot',
      'browser_click',
      'browser_fill',
      'browser_console',
    ]);

    // Dev server dijalankan otomatis oleh tool pertama; layar ponsel 390 px memotong tombol 600 px.
    const before = await rpc(reg, 'tools/call', {
      name: 'browser_screenshot',
      arguments: { width: 390, height: 700 },
    });
    expect(before.body.result.isError).toBeUndefined();
    expect(textOf(before)).toContain('Tata letak bermasalah');
    const imageBefore = imageOf(before);
    expect(imageBefore.mimeType).toBe('image/png');
    expect(Buffer.from(imageBefore.data, 'base64').subarray(1, 4).toString()).toBe('PNG');
    expect(service.get({ projectId: PROJECT, runId: RUN })?.status).toBe('ready');

    // Elemen terpotong: lebarnya melebihi viewport.
    const box = await rpc(reg, 'tools/call', {
      name: 'browser_screenshot',
      arguments: { selector: '#simpan' },
    });
    expect(textOf(box)).toContain('viewport 390x700');

    // "Perbaiki": ubah CSS, lalu verifikasi dengan screenshot kedua (reload).
    await fs.writeFile(
      path.join(project, 'style.css'),
      '#simpan { width: 100%; max-width: 100%; }',
    );
    const after = await rpc(reg, 'tools/call', {
      name: 'browser_screenshot',
      arguments: { reload: true },
    });
    const imageAfter = imageOf(after);
    expect(imageAfter.data).not.toBe(imageBefore.data);

    // Console dan request gagal terbaca; klik dan isi bekerja.
    const consoleOut = await rpc(reg, 'tools/call', { name: 'browser_console', arguments: {} });
    expect(textOf(consoleOut)).toContain('halo dari halaman');
    const click = await rpc(reg, 'tools/call', {
      name: 'browser_click',
      arguments: { selector: '#simpan' },
    });
    expect(textOf(click)).toContain('Diklik');
    const missing = await rpc(reg, 'tools/call', {
      name: 'browser_click',
      arguments: { selector: '#tidak-ada' },
    });
    expect(missing.body.result.isError).toBe(true);
  }, 120_000);

  it('hanya halaman preview yang boleh dibuka; run selesai mematikan dev server dan sesi browser', async () => {
    service = makeService();
    const reg = (await service.registerRun({ projectId: PROJECT, runId: RUN }))!;
    await rpc(reg, 'tools/call', { name: 'browser_screenshot', arguments: {} });
    const devUrl = service.get({ projectId: PROJECT, runId: RUN })!.devUrl!;

    const outside = await rpc(reg, 'tools/call', {
      name: 'browser_screenshot',
      arguments: { path: 'http://example.com/' },
    });
    expect(outside.body.result.isError).toBe(true);
    expect(textOf(outside)).toContain('preview project ini');

    reg.unregister();
    await service.stopRun(PROJECT, RUN);

    await refused(devUrl);
    expect(
      (await fetch(reg.url, { method: 'POST', headers: reg.headers, body: '{}' })).status,
    ).toBe(401);
  }, 120_000);

  it('lampiran composer: tangkapan satu elemen dari preview yang berjalan', async () => {
    service = makeService();
    await service.start({ projectId: PROJECT });

    const shot = await service.shot(
      { projectId: PROJECT },
      { selector: '#simpan', width: 800, height: 600 },
    );

    expect(shot.png.subarray(1, 4).toString()).toBe('PNG');
    expect(shot.width).toBe(800);
    await expect(service.shot({ projectId: PROJECT, runId: RUN }, {})).rejects.toThrow(
      'belum berjalan',
    );
  }, 120_000);
});
