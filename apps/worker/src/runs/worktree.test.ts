import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { workerBranchFor } from '@aios/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AllowList } from '../paths/allowlist.js';
import { ProcessManager } from '../process/manager.js';
import { ApprovalRules, normalizeDetail } from './rules.js';
import { WorktreeError, WorktreeManager } from './worktree.js';

const RUN_A = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';
const RUN_B = '0192f0c4-7a1b-7c2d-9e3f-4a5b6c7d8e90';

let base: string;
let repo: string;
let manager: WorktreeManager;
let allowed: AllowList;

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd,
    encoding: 'utf8',
  }).trim();

beforeEach(async () => {
  base = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'aios-wt-')));
  repo = path.join(base, 'izin', 'aplikasi');
  await fs.mkdir(repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  await fs.writeFile(path.join(repo, 'README.md'), 'halo\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'awal');
  allowed = new AllowList({ file: path.join(base, 'data', 'allowed.json'), forbidden: [] });
  await allowed.add(path.join(base, 'izin'));
  const processes = new ProcessManager({
    checkCwd: (cwd) =>
      allowed.resolveDirectory(cwd).catch(() => {
        // Worktree cadangan di folder data dikelola worker sendiri.
        if (manager.contains(cwd)) return cwd;
        throw new Error('ditolak');
      }),
  });
  manager = new WorktreeManager({ processes, allowed, dataDir: path.join(base, 'data') });
});
afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true });
});

describe('WorktreeManager', () => {
  it('membuat worktree di .aios-worktrees di samping repo, branch aios/<id pendek>, tanpa menyentuh repo asli', async () => {
    const headBefore = git(repo, 'rev-parse', 'HEAD');

    const wt = await manager.create(RUN_A, repo);

    expect(wt.branch).toBe(workerBranchFor(RUN_A));
    expect(wt.branch).toMatch(/^aios\/[0-9a-f]{8}$/);
    expect(path.dirname(path.dirname(wt.root))).toBe(path.join(base, 'izin'));
    expect(path.basename(path.dirname(wt.root))).toBe('.aios-worktrees');
    expect(wt.cwd).toBe(wt.root);
    expect((await fs.readFile(path.join(wt.root, 'README.md'), 'utf8')).trim()).toBe('halo');
    expect(git(wt.root, 'branch', '--show-current')).toBe(wt.branch);
    // Repo asli: branch, commit, dan file kerja tidak berubah.
    expect(git(repo, 'branch', '--show-current')).toBe('main');
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(headBefore);
    expect(git(repo, 'status', '--porcelain')).toBe('');
    expect(wt.base).toBe(headBefore);
  });

  it('project di subfolder repo: cwd agent = subfolder yang sama di dalam worktree', async () => {
    await fs.mkdir(path.join(repo, 'packages', 'web'), { recursive: true });
    await fs.writeFile(path.join(repo, 'packages', 'web', 'a.txt'), 'x');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'sub');

    const wt = await manager.create(RUN_A, path.join(repo, 'packages', 'web'));

    expect(wt.cwd).toBe(path.join(wt.root, 'packages', 'web'));
    expect(await fs.readFile(path.join(wt.cwd, 'a.txt'), 'utf8')).toBe('x');
  });

  it('perubahan agent di worktree tidak muncul di repo asli', async () => {
    const wt = await manager.create(RUN_A, repo);

    await fs.writeFile(path.join(wt.cwd, 'baru.txt'), 'dari agent');
    await fs.writeFile(path.join(wt.cwd, 'README.md'), 'diubah\n');

    expect(git(repo, 'status', '--porcelain')).toBe('');
    expect(await fs.readFile(path.join(repo, 'README.md'), 'utf8')).toBe('halo\n');
    await expect(fs.stat(path.join(repo, 'baru.txt'))).rejects.toThrow();
  });

  it('dua run paralel mendapat worktree dan branch sendiri', async () => {
    const [a, b] = await Promise.all([manager.create(RUN_A, repo), manager.create(RUN_B, repo)]);

    expect(a.root).not.toBe(b.root);
    expect(a.branch).not.toBe(b.branch);
    expect(git(repo, 'branch', '--list', 'aios/*').split('\n')).toHaveLength(2);
  });

  it('isPristine: bersih bila tidak ada perubahan; tidak bersih setelah file berubah', async () => {
    const wt = await manager.create(RUN_A, repo);
    expect(await manager.isPristine(RUN_A)).toBe(true);

    await fs.writeFile(path.join(wt.cwd, 'x.txt'), 'x');

    expect(await manager.isPristine(RUN_A)).toBe(false);
  });

  it('commitAll menyimpan perubahan sebagai satu commit di branch kerja saja', async () => {
    const wt = await manager.create(RUN_A, repo);
    await fs.writeFile(path.join(wt.cwd, 'math.test.js'), 'tes');

    expect(await manager.commitAll(RUN_A, 'test: tambah tes')).toBe(true);

    expect(git(wt.root, 'log', '-1', '--format=%s')).toBe('test: tambah tes');
    expect(git(repo, 'log', '-1', '--format=%s')).toBe('awal');
    expect(git(repo, 'ls-tree', '-r', '--name-only', wt.branch)).toContain('math.test.js');
    expect(await manager.commitAll(RUN_A, 'lagi')).toBe(false);
  });

  it('remove menghapus folder dan worktree terdaftar; deleteBranch juga menghapus branch', async () => {
    const wt = await manager.create(RUN_A, repo);
    const kept = await manager.create(RUN_B, repo);

    await manager.remove(RUN_A, { deleteBranch: true });
    await manager.remove(RUN_B, { deleteBranch: false });

    await expect(fs.stat(wt.root)).rejects.toThrow();
    await expect(fs.stat(kept.root)).rejects.toThrow();
    expect(git(repo, 'worktree', 'list', '--porcelain')).not.toContain('.aios-worktrees');
    const branches = git(repo, 'branch', '--list', 'aios/*');
    expect(branches).not.toContain(wt.branch);
    expect(branches).toContain(kept.branch);
    expect(manager.get(RUN_A)).toBeUndefined();
  });

  it('folder .aios-worktrees di luar folder izin: memakai folder data worker', async () => {
    const solo = path.join(base, 'solo');
    await fs.mkdir(solo);
    git(solo, 'init', '-q', '-b', 'main');
    await fs.writeFile(path.join(solo, 'a.txt'), 'a');
    git(solo, 'add', '-A');
    git(solo, 'commit', '-q', '-m', 'a');
    await allowed.add(solo); // hanya folder repo; saudaranya (.aios-worktrees) tidak diizinkan

    const wt = await manager.create(RUN_A, solo);

    expect(wt.root.startsWith(path.join(base, 'data', 'worktrees'))).toBe(true);
    expect(manager.contains(wt.cwd)).toBe(true);
    expect(manager.contains(path.join(base, 'izin'))).toBe(false);
  });

  it('bukan repo git dan repo tanpa commit ditolak dengan pesan jelas', async () => {
    const plain = path.join(base, 'izin', 'polos');
    await fs.mkdir(plain);
    const empty = path.join(base, 'izin', 'kosong');
    await fs.mkdir(empty);
    git(empty, 'init', '-q', '-b', 'main');

    await expect(manager.create(RUN_A, plain)).rejects.toMatchObject({ code: 'not_a_repo' });
    await expect(manager.create(RUN_B, empty)).rejects.toMatchObject({ code: 'no_commits' });
    await expect(manager.create(RUN_B, empty)).rejects.toBeInstanceOf(WorktreeError);
  });
});

describe('ApprovalRules', () => {
  let rules: ApprovalRules;
  beforeEach(async () => {
    rules = new ApprovalRules(path.join(base, 'data', 'rules.json'));
    await rules.load();
  });

  it('perintah cocok persis (spasi dirapikan), bukan awalan atau project lain', async () => {
    await rules.add('p1', 'command', 'pnpm   test ');

    expect(rules.matches('p1', 'command', 'pnpm test')).toBe(true);
    expect(rules.matches('p1', 'command', 'pnpm test && rm -rf /')).toBe(false);
    expect(rules.matches('p1', 'command', 'pnpm tes')).toBe(false);
    expect(rules.matches('p2', 'command', 'pnpm test')).toBe(false);
    expect(rules.matches('p1', 'network', 'pnpm test')).toBe(false);
  });

  it('penulisan file: satu aturan per project untuk semua penulisan', async () => {
    await rules.add('p1', 'file_write', 'Path: a.ts');

    expect(rules.matches('p1', 'file_write', 'Path: b/c.ts\nContent: x')).toBe(true);
    expect(rules.matches('p1', 'command', 'Path: a.ts')).toBe(false);
    expect(rules.list('p1')).toEqual([{ projectId: 'p1', kind: 'file_write', pattern: '*' }]);
  });

  it('tidak ganda, bertahan di disk, dan bisa dihapus per project', async () => {
    await rules.add('p1', 'command', 'npm test');
    await rules.add('p1', 'command', 'npm  test');
    expect(rules.list('p1')).toHaveLength(1);

    const reloaded = new ApprovalRules(path.join(base, 'data', 'rules.json'));
    await reloaded.load();
    expect(reloaded.matches('p1', 'command', 'npm test')).toBe(true);

    await reloaded.remove('p1');
    expect(reloaded.matches('p1', 'command', 'npm test')).toBe(false);
  });

  it('berkas rusak: mulai tanpa aturan (selalu bertanya)', async () => {
    await fs.writeFile(path.join(base, 'data', 'rules.json'), '{rusak');
    const broken = new ApprovalRules(path.join(base, 'data', 'rules.json'));

    await broken.load();

    expect(broken.matches('p1', 'command', 'npm test')).toBe(false);
  });

  it('normalizeDetail tidak mengubah huruf besar/kecil', () => {
    expect(normalizeDetail('  Git   Status\n')).toBe('Git Status');
  });
});
