import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AllowList } from '../paths/allowlist.js';
import { ProcessManager } from '../process/manager.js';
import { ProjectBindings } from './bindings.js';
import { detectStack } from './detect.js';
import { detectGit } from './git.js';

let base: string;
beforeEach(async () => {
  base = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'aios-proj-')));
});
afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true });
});

async function dir(name: string, files: Record<string, string>): Promise<string> {
  const root = path.join(base, name);
  await fs.mkdir(root, { recursive: true });
  for (const [file, content] of Object.entries(files)) {
    await fs.writeFile(path.join(root, file), content);
  }
  return root;
}

describe('detectStack', () => {
  it('Node + TypeScript: framework dari dependensi, pnpm dari kolom packageManager, perintah dev berupa array', async () => {
    const root = await dir('web', {
      'package.json': JSON.stringify({
        packageManager: 'pnpm@10.13.1',
        scripts: { dev: 'vite', build: 'tsc' },
        dependencies: { react: '^19', zod: '^4' },
        devDependencies: { vite: '^8', typescript: '^6' },
      }),
    });

    expect(await detectStack(root)).toEqual({
      languages: ['javascript', 'typescript'],
      frameworks: ['react', 'vite'],
      packageManager: 'pnpm',
      devCommand: ['pnpm', 'run', 'dev'],
    });
  });

  it('manajer paket dari lockfile bila tidak dideklarasikan; scripts.start dipakai bila tidak ada dev', async () => {
    const root = await dir('api', {
      'package.json': JSON.stringify({
        scripts: { start: 'node .' },
        dependencies: { express: '1' },
      }),
      'yarn.lock': '',
    });

    expect(await detectStack(root)).toMatchObject({
      packageManager: 'yarn',
      devCommand: ['yarn', 'run', 'start'],
      frameworks: ['express'],
    });
  });

  it('Python: poetry, framework dari manifes', async () => {
    const root = await dir('py', {
      'pyproject.toml': '[tool.poetry]\nname="x"\n[tool.poetry.dependencies]\nfastapi="*"\n',
    });

    expect(await detectStack(root)).toEqual({
      languages: ['python'],
      frameworks: ['fastapi'],
      packageManager: 'poetry',
    });
  });

  it('Gradle Android (Kotlin DSL), Rust Tauri, dan Go', async () => {
    const android = await dir('android', {
      'build.gradle.kts': 'plugins { id("com.android.application"); kotlin("android") }',
      'settings.gradle.kts': '',
    });
    const tauri = await dir('tauri', { 'Cargo.toml': '[dependencies]\ntauri = "2"\n' });
    const go = await dir('go', { 'go.mod': 'module x' });

    expect(await detectStack(android)).toEqual({
      languages: ['kotlin'],
      frameworks: ['android'],
      packageManager: 'gradle',
    });
    expect(await detectStack(tauri)).toEqual({
      languages: ['rust'],
      frameworks: ['tauri'],
      packageManager: 'cargo',
      devCommand: ['cargo', 'run'],
    });
    expect(await detectStack(go)).toEqual({
      languages: ['go'],
      frameworks: [],
      packageManager: 'go',
    });
  });

  it('monorepo campuran menggabungkan bahasa tanpa ganda', async () => {
    const root = await dir('mono', {
      'package.json': JSON.stringify({ dependencies: {} }),
      'Cargo.toml': '[package]\nname="x"\n',
      'tsconfig.json': '{}',
    });

    const stack = await detectStack(root);
    expect(stack.languages).toEqual(['javascript', 'typescript', 'rust']);
  });

  it('folder kosong dan manifes rusak tidak melempar', async () => {
    const empty = await dir('kosong', {});
    const broken = await dir('rusak', { 'package.json': '{bukan json' });

    expect(await detectStack(empty)).toEqual({ languages: [], frameworks: [] });
    expect(await detectStack(broken)).toEqual({ languages: [], frameworks: [] });
  });

  it('manifes raksasa diabaikan (batas 1 MB) dan tidak dieksekusi', async () => {
    const huge = await dir('besar', { 'package.json': ` ${'x'.repeat(1024 * 1024 + 10)}` });

    expect(await detectStack(huge)).toEqual({ languages: [], frameworks: [] });
  });
});

describe('detectGit', () => {
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
      cwd,
      stdio: 'ignore',
    });

  it('bukan repo git', async () => {
    const root = await dir('plain', {});

    expect(await detectGit(new ProcessManager(), root)).toEqual({
      isRepo: false,
      defaultBranch: null,
      currentBranch: null,
    });
  });

  it('repo tanpa remote: cabang bawaan = cabang saat ini', async () => {
    const root = await dir('repo', {});
    git(root, 'init', '-q', '-b', 'trunk');
    git(root, 'commit', '-q', '--allow-empty', '-m', 'awal');

    expect(await detectGit(new ProcessManager(), root)).toEqual({
      isRepo: true,
      defaultBranch: 'trunk',
      currentBranch: 'trunk',
    });
  });

  it('repo baru tanpa commit tetap terdeteksi', async () => {
    const root = await dir('baru', {});
    git(root, 'init', '-q', '-b', 'main');

    expect(await detectGit(new ProcessManager(), root)).toMatchObject({
      isRepo: true,
      defaultBranch: 'main',
    });
  });

  it('dengan origin/HEAD: cabang bawaan dari remote, bukan cabang yang sedang dikerjakan', async () => {
    const root = await dir('remote', {});
    git(root, 'init', '-q', '-b', 'main');
    git(root, 'commit', '-q', '--allow-empty', '-m', 'awal');
    git(root, 'update-ref', 'refs/remotes/origin/develop', 'HEAD');
    git(root, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/develop');
    git(root, 'checkout', '-q', '-b', 'fitur');

    expect(await detectGit(new ProcessManager(), root)).toEqual({
      isRepo: true,
      defaultBranch: 'develop',
      currentBranch: 'fitur',
    });
  });

  it('HEAD lepas: cabang saat ini null, bawaan tetap terisi', async () => {
    const root = await dir('detached', {});
    git(root, 'init', '-q', '-b', 'main');
    git(root, 'commit', '-q', '--allow-empty', '-m', 'awal');
    git(root, 'checkout', '-q', '--detach');

    expect(await detectGit(new ProcessManager(), root)).toEqual({
      isRepo: true,
      defaultBranch: 'main',
      currentBranch: null,
    });
  });
});

describe('ProjectBindings', () => {
  const ID = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';

  async function setup() {
    const allowedRoot = path.join(base, 'izin');
    await fs.mkdir(path.join(allowedRoot, 'app'), { recursive: true });
    const allowed = new AllowList({ file: path.join(base, 'data', 'allowed.json'), forbidden: [] });
    await allowed.add(allowedRoot);
    const bindings = new ProjectBindings(path.join(base, 'data', 'projects.json'), allowed);
    return { allowedRoot, allowed, bindings };
  }

  it('mengikat project ke folder yang diizinkan dan menyimpannya di disk', async () => {
    const { allowedRoot, allowed, bindings } = await setup();
    const app = path.join(allowedRoot, 'app');

    expect(await bindings.bind(ID, app)).toEqual({ projectId: ID, path: app, available: true });

    const reloaded = new ProjectBindings(path.join(base, 'data', 'projects.json'), allowed);
    await reloaded.load();
    expect(await reloaded.list()).toEqual([{ projectId: ID, path: app, available: true }]);
    expect(await reloaded.pathFor(ID)).toBe(app);
  });

  it('menolak folder di luar daftar izin', async () => {
    const { bindings } = await setup();
    const outside = await dir('luar', {});

    await expect(bindings.bind(ID, outside)).rejects.toMatchObject({ code: 'path_not_allowed' });
    expect(await bindings.list()).toEqual([]);
  });

  it('available false bila folder dihapus atau izinnya dicabut; pathFor melempar', async () => {
    const { allowedRoot, allowed, bindings } = await setup();
    const app = path.join(allowedRoot, 'app');
    await bindings.bind(ID, app);

    await allowed.remove(allowedRoot);

    expect(await bindings.list()).toEqual([{ projectId: ID, path: app, available: false }]);
    await expect(bindings.pathFor(ID)).rejects.toMatchObject({ code: 'path_not_allowed' });
  });

  it('unbind menghapus ikatan; pathFor project tak dikenal undefined', async () => {
    const { allowedRoot, bindings } = await setup();
    await bindings.bind(ID, path.join(allowedRoot, 'app'));

    await bindings.unbind(ID);

    expect(await bindings.list()).toEqual([]);
    expect(await bindings.pathFor(ID)).toBeUndefined();
  });

  it('berkas ikatan rusak: mulai kosong', async () => {
    const { allowed } = await setup();
    await fs.writeFile(path.join(base, 'data', 'projects.json'), 'bukan json');
    const bindings = new ProjectBindings(path.join(base, 'data', 'projects.json'), allowed);

    await bindings.load();

    expect(await bindings.list()).toEqual([]);
  });
});
