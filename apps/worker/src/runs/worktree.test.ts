import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { workerBranchFor } from '@aios/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AllowList } from '../paths/allowlist.js';
import { ProcessManager } from '../process/manager.js';
import { ApprovalRules, normalizeDetail } from './rules.js';
import { WorktreeError, WorktreeManager, movesHead, type Worktree } from './worktree.js';

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
    expect(path.dirname(path.dirname(wt.top))).toBe(path.join(base, 'izin'));
    expect(path.basename(path.dirname(wt.top))).toBe('.aios-worktrees');
    expect(wt.cwd).toBe(wt.top);
    expect((await fs.readFile(path.join(wt.top, 'README.md'), 'utf8')).trim()).toBe('halo');
    expect(git(wt.top, 'branch', '--show-current')).toBe(wt.branch);
    // Repo asli: branch, commit, dan file kerja tidak berubah.
    expect(git(repo, 'branch', '--show-current')).toBe('main');
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(headBefore);
    expect(git(repo, 'status', '--porcelain')).toBe('');
    expect(wt.base).toBe(headBefore);
  });

  it('dua run paralel di repo yang sama: worktree dan branch terpisah, commit tidak saling mengganggu', async () => {
    const headBefore = git(repo, 'rev-parse', 'HEAD');

    const [a, b] = await Promise.all([manager.create(RUN_A, repo), manager.create(RUN_B, repo)]);

    expect(a.branch).not.toBe(b.branch);
    expect(a.top).not.toBe(b.top);
    // Keduanya mengubah berkas yang sama secara berbeda; masing-masing hanya melihat ubahannya sendiri.
    await Promise.all([
      fs.writeFile(path.join(a.top, 'README.md'), 'dari A\n'),
      fs.writeFile(path.join(b.top, 'README.md'), 'dari B\n'),
      fs.writeFile(path.join(b.top, 'b.txt'), 'hanya B\n'),
    ]);
    const [committedA, committedB] = await Promise.all([
      manager.commitAll(RUN_A, 'feat: ubah dari A'),
      manager.commitAll(RUN_B, 'feat: ubah dari B'),
    ]);

    expect([committedA, committedB]).toEqual([true, true]);
    expect(git(repo, 'show', `${a.branch}:README.md`)).toBe('dari A');
    expect(git(repo, 'show', `${b.branch}:README.md`)).toBe('dari B');
    expect(git(repo, 'ls-tree', '--name-only', a.branch)).not.toContain('b.txt');
    expect(git(repo, 'rev-list', '--count', `${headBefore}..${a.branch}`)).toBe('1');
    expect(git(repo, 'rev-list', '--count', `${headBefore}..${b.branch}`)).toBe('1');
    // Repo asli tidak tersentuh.
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(headBefore);
    expect(git(repo, 'status', '--porcelain')).toBe('');
    expect((await fs.readFile(path.join(repo, 'README.md'), 'utf8')).trim()).toBe('halo');
  });

  it('project di subfolder repo: cwd agent = subfolder yang sama di dalam worktree', async () => {
    await fs.mkdir(path.join(repo, 'packages', 'web'), { recursive: true });
    await fs.writeFile(path.join(repo, 'packages', 'web', 'a.txt'), 'x');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'sub');

    const wt = await manager.create(RUN_A, path.join(repo, 'packages', 'web'));

    expect(wt.cwd).toBe(path.join(wt.top, 'packages', 'web'));
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

    expect(a.top).not.toBe(b.top);
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

    expect(git(wt.top, 'log', '-1', '--format=%s')).toBe('test: tambah tes');
    expect(git(repo, 'log', '-1', '--format=%s')).toBe('awal');
    expect(git(repo, 'ls-tree', '-r', '--name-only', wt.branch)).toContain('math.test.js');
    expect(await manager.commitAll(RUN_A, 'lagi')).toBe(false);
  });

  it('remove menghapus folder dan worktree terdaftar; deleteBranch juga menghapus branch', async () => {
    const wt = await manager.create(RUN_A, repo);
    const kept = await manager.create(RUN_B, repo);

    await manager.remove(RUN_A, { deleteBranch: true });
    await manager.remove(RUN_B, { deleteBranch: false });

    await expect(fs.stat(wt.top)).rejects.toThrow();
    await expect(fs.stat(kept.top)).rejects.toThrow();
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

    expect(wt.top.startsWith(path.join(base, 'data', 'worktrees'))).toBe(true);
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

describe('WorktreeManager: mode in_place', () => {
  it('membuka folder project di branch aktif: tanpa worktree, tanpa branch aios, ref checkpoint per run', async () => {
    const head = git(repo, 'rev-parse', 'HEAD');

    const ws = await manager.openInPlace(RUN_A, repo, { projectId: 'p' });

    expect(ws).toMatchObject({
      kind: 'in_place',
      repo,
      top: repo,
      cwd: repo,
      branch: 'main',
      base: head,
      checkpointRef: `refs/aios/cp/${RUN_A}`,
    });
    expect('worktreeDir' in ws).toBe(false);
    expect(git(repo, 'branch', '--list', 'aios/*')).toBe('');
    expect(git(repo, 'worktree', 'list', '--porcelain').match(/^worktree /gm)).toHaveLength(1);
    // Folder project bukan "worktree milik worker": tidak dipakai sebagai pengecualian izin cwd.
    expect(manager.contains(repo)).toBe(false);
  });

  it('ditolak: detached HEAD, perubahan belum di-commit (terlacak atau berkas baru), run lain di repo', async () => {
    git(repo, 'checkout', '-q', '--detach');
    await expect(manager.openInPlace(RUN_A, repo)).rejects.toMatchObject({
      code: 'workspace_detached',
    });
    git(repo, 'checkout', '-q', 'main');

    await fs.writeFile(path.join(repo, 'README.md'), 'diubah pemilik\n');
    await expect(manager.openInPlace(RUN_A, repo)).rejects.toMatchObject({
      code: 'workspace_dirty',
      message: expect.stringContaining('worktree terpisah') as string,
    });
    git(repo, 'checkout', '-q', '--', 'README.md');
    await fs.writeFile(path.join(repo, 'baru.txt'), 'belum dilacak\n');
    await expect(manager.openInPlace(RUN_A, repo)).rejects.toMatchObject({
      code: 'workspace_dirty',
    });
    // Berkas yang diabaikan git tidak dihitung kotor.
    await fs.rm(path.join(repo, 'baru.txt'));
    await fs.writeFile(path.join(repo, '.git', 'info', 'exclude'), 'node_modules/\n');
    await fs.mkdir(path.join(repo, 'node_modules'));
    await fs.writeFile(path.join(repo, 'node_modules', 'x.js'), 'x');

    // Run worktree yang sedang berjalan di repo yang sama juga memblokir.
    await manager.create(RUN_B, repo);
    await expect(manager.openInPlace(RUN_A, repo)).rejects.toMatchObject({
      code: 'workspace_busy',
    });
    await manager.setState(RUN_B, 'review');
    await manager.openInPlace(RUN_A, repo);

    // Hasil in_place yang menunggu tinjauan memegang kunci repo.
    await manager.setState(RUN_A, 'review');
    const third = '0192f0c4-7a1b-7c2d-aaaa-4a5b6c7d8e91';
    await expect(manager.openInPlace(third, repo)).rejects.toMatchObject({
      code: 'workspace_busy',
      message: expect.stringContaining('menunggu tinjauan') as string,
    });
  });

  it('dua pembukaan bersamaan di repo yang sama: keduanya pembaca, hanya satu yang bisa menjadi penulis', async () => {
    const results = await Promise.allSettled([
      manager.openInPlace(RUN_A, repo),
      manager.openInPlace(RUN_B, repo),
    ]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(manager.claimWrite(RUN_A)).toBe(true);
    expect(manager.claimWrite(RUN_A)).toBe(true);
    expect(manager.claimWrite(RUN_B)).toBe(false);
    // B berbagi folder dengan penulis: tanpa tinjauan; A tetap penulis biasa.
    expect(manager.isBystander(RUN_B)).toBe(true);
    expect(manager.isBystander(RUN_A)).toBe(false);
  });

  it('pembaca tidak mengunci repo; penulis yang berjalan mengunci; pembaca yang tersisa tidak bisa menulis lagi', async () => {
    await manager.openInPlace(RUN_A, repo);
    // A belum meminta izin tulis: B boleh dibuka.
    await manager.openInPlace(RUN_B, repo);
    expect(manager.claimWrite(RUN_B)).toBe(true);
    const third = '0192f0c4-7a1b-7c2d-aaaa-4a5b6c7d8e92';
    await expect(manager.openInPlace(third, repo)).rejects.toMatchObject({
      code: 'workspace_busy',
      message: expect.stringContaining('sedang berjalan') as string,
    });
    // B selesai tanpa perubahan dan dilepas: A tetap pembaca (folder pernah dipakai penulis lain).
    await manager.remove(RUN_B, { deleteBranch: true });
    expect(manager.claimWrite(RUN_A)).toBe(false);
    await manager.openInPlace(third, repo);
    // Worktree selalu boleh menulis: foldernya milik run itu sendiri.
    const fourth = '0192f0c4-7a1b-7c2d-aaaa-4a5b6c7d8e93';
    await manager.create(fourth, repo);
    expect(manager.claimWrite(fourth)).toBe(true);
  });

  it('mode rencana: folder kotor boleh, tidak memegang kunci repo', async () => {
    await fs.writeFile(path.join(repo, 'README.md'), 'diubah pemilik\n');
    const plan = await manager.openInPlace(RUN_A, repo, { planOnly: true });
    expect(plan.planOnly).toBe(true);
    git(repo, 'checkout', '-q', '--', 'README.md');
    await manager.openInPlace(RUN_B, repo);
  });

  it('remove pada in_place: tidak pernah fs.rm folder project atau induknya, tidak pernah branch -D', async () => {
    const ws = await manager.openInPlace(RUN_A, repo);
    await fs.writeFile(path.join(repo, 'baru.txt'), 'perubahan run\n');
    const rm = vi.spyOn(fs, 'rm');
    const gitCalls = vi.spyOn(manager, 'git');

    await manager.remove(RUN_A, { deleteBranch: true });

    for (const [target] of rm.mock.calls) {
      expect(path.relative(String(target), repo).startsWith('..')).toBe(true);
    }
    for (const [, args] of gitCalls.mock.calls) {
      expect(args).not.toContain('-D');
      expect(args.slice(0, 2)).not.toEqual(['worktree', 'remove']);
    }
    expect(git(repo, 'branch', '--list', 'main')).not.toBe('');
    expect(await fs.readFile(path.join(repo, 'baru.txt'), 'utf8')).toBe('perubahan run\n');
    expect(await fs.readFile(path.join(repo, 'README.md'), 'utf8')).toBe('halo\n');
    expect(manager.get(ws.runId)).toBeUndefined();
    rm.mockRestore();
    gitCalls.mockRestore();
  });

  it('catatan worktree palsu yang menunjuk repo atau induknya ditolak sebelum menghapus apa pun', async () => {
    const forged: Worktree = {
      kind: 'worktree',
      runId: RUN_A,
      projectId: 'p',
      repo,
      top: repo,
      worktreeDir: repo,
      cwd: repo,
      branch: 'aios/12345678',
      base: git(repo, 'rev-parse', 'HEAD'),
      checkpointRef: `refs/aios/cp/${RUN_A}`,
      planOnly: false,
    };
    const parent = { ...forged, worktreeDir: path.dirname(repo), top: path.dirname(repo) };
    const owner = {
      ...forged,
      worktreeDir: path.join(base, 'data', 'worktrees', 'x'),
      branch: 'main',
    };
    await fs.mkdir(path.join(base, 'data'), { recursive: true });
    await fs.writeFile(
      path.join(base, 'data', 'workspaces.json'),
      JSON.stringify({
        version: 1,
        items: [forged, parent, owner].map((w, i) => ({
          ...w,
          runId: `${RUN_A.slice(0, -1)}${i}`,
          state: 'stale',
        })),
      }),
    );

    await manager.recover([repo]);

    expect(await fs.readFile(path.join(repo, 'README.md'), 'utf8')).toBe('halo\n');
    expect(git(repo, 'branch', '--list', 'main')).not.toBe('');
  });
});

describe('WorktreeManager: pemulihan saat worker mulai', () => {
  const fresh = () =>
    new WorktreeManager({
      processes: new ProcessManager({
        checkCwd: (cwd) =>
          allowed.resolveDirectory(cwd).catch(() => {
            throw new Error('ditolak');
          }),
      }),
      allowed,
      dataDir: path.join(base, 'data'),
    });

  it('in_place yang terputus dipulihkan; yang sudah bersih dilepas', async () => {
    await manager.openInPlace(RUN_A, repo);
    await fs.writeFile(path.join(repo, 'README.md'), 'setengah jadi\n');

    const restarted = fresh();
    expect(await restarted.recover([repo])).toEqual([RUN_A]);
    expect(restarted.get(RUN_A)).toMatchObject({ kind: 'in_place', branch: 'main' });
    expect(restarted.state(RUN_A)).toBe('review');
    expect(restarted.pendingInPlace().map((w) => w.runId)).toEqual([RUN_A]);
    expect(await fs.readFile(path.join(repo, 'README.md'), 'utf8')).toBe('setengah jadi\n');

    git(repo, 'checkout', '-q', '--', 'README.md');
    const again = fresh();
    expect(await again.recover([repo])).toEqual([]);
    expect(again.get(RUN_A)).toBeUndefined();
  });

  it('worktree menunggu tinjauan bertahan; yang terputus, berhenti, atau sisa versi lama dibersihkan', async () => {
    const review = await manager.create(RUN_A, repo);
    await manager.setState(RUN_A, 'review');
    const interrupted = await manager.create(RUN_B, repo);
    // Sisa versi lama: worktree aios di lokasi milik worker tanpa catatan.
    const legacyDir = path.join(base, 'izin', '.aios-worktrees', 'aplikasi-deadbeef');
    git(repo, 'worktree', 'add', '-q', '-b', 'aios/deadbeef', legacyDir, 'HEAD');
    // Sisa lama dengan commit unik: foldernya dibuang, branch-nya dibiarkan.
    const uniqueDir = path.join(base, 'izin', '.aios-worktrees', 'aplikasi-cafebabe');
    git(repo, 'worktree', 'add', '-q', '-b', 'aios/cafebabe', uniqueDir, 'HEAD');
    await fs.writeFile(path.join(uniqueDir, 'u.txt'), 'u');
    git(uniqueDir, 'add', '-A');
    git(uniqueDir, 'commit', '-q', '-m', 'unik');

    const restarted = fresh();
    await restarted.recover([repo]);

    expect(restarted.get(RUN_A)).toMatchObject({ kind: 'worktree', top: review.top });
    await expect(fs.stat(review.top)).resolves.toBeDefined();
    await expect(fs.stat(interrupted.top)).rejects.toThrow();
    await expect(fs.stat(legacyDir)).rejects.toThrow();
    await expect(fs.stat(uniqueDir)).rejects.toThrow();
    const branches = git(repo, 'branch', '--list', 'aios/*');
    expect(branches).toContain(review.branch);
    expect(branches).not.toContain(interrupted.branch);
    expect(branches).not.toContain('aios/deadbeef');
    expect(branches).toContain('aios/cafebabe');
    expect(git(repo, 'status', '--porcelain')).toBe('');
  });
});

describe('movesHead', () => {
  it('perintah git yang memindahkan HEAD atau branch dikenali; yang membaca tidak', () => {
    for (const cmd of [
      'git commit -am "x"',
      'git checkout main',
      'git switch -c baru',
      'git reset --hard HEAD~1',
      'git stash',
      'npm test && git rebase main',
      'git -C sub pull',
      'git cherry-pick abc',
      'git revert HEAD',
      'git merge fitur',
    ]) {
      expect(movesHead(cmd), cmd).toBe(true);
    }
    for (const cmd of [
      'git status',
      'git diff HEAD',
      'git log --oneline',
      'git show HEAD:a.txt',
      'echo commit',
      'pnpm typecheck',
    ]) {
      expect(movesHead(cmd), cmd).toBe(false);
    }
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

  it('tool konektor diingat per konektor dan per nama tool, bukan per argumen', async () => {
    await rules.add(
      'p1',
      'network',
      'mcp__konektor_github_create_issue\nArguments:\n{"title":"bug","body":"a"}',
    );

    expect(rules.list('p1')).toEqual([
      { projectId: 'p1', kind: 'network', pattern: 'mcp__konektor_github_create_issue' },
    ]);
    expect(
      rules.matches(
        'p1',
        'network',
        'mcp__konektor_github_create_issue\nArguments:\n{"title":"lain sekali","repo":"x/y"}',
      ),
    ).toBe(true);
    // Tool lain di konektor yang sama, dan konektor lain, tetap ditanyakan.
    expect(rules.matches('p1', 'network', 'mcp__konektor_github_delete_repo\nArguments:\n{}')).toBe(
      false,
    );
    expect(
      rules.matches('p1', 'network', 'mcp__konektor_linear_create_issue\nArguments:\n{}'),
    ).toBe(false);
    expect(rules.matches('p2', 'network', 'mcp__konektor_github_create_issue')).toBe(false);
  });

  it('tool mcp di luar konektor terdaftar tetap cocok hanya pada detail penuh yang sama', async () => {
    await rules.add('p1', 'command', 'mcp__github__x\nArguments:\n{"a":1}');

    expect(rules.list('p1')).toEqual([
      { projectId: 'p1', kind: 'command', pattern: 'mcp__github__x Arguments: {"a":1}' },
    ]);
    expect(rules.matches('p1', 'command', 'mcp__github__x\nArguments:\n{"a":1}')).toBe(true);
    expect(rules.matches('p1', 'command', 'mcp__github__x\nArguments:\n{"a":2}')).toBe(false);
    expect(rules.matches('p1', 'command', 'mcp__github__x')).toBe(false);
  });

  it('normalizeDetail tidak mengubah huruf besar/kecil', () => {
    expect(normalizeDetail('  Git   Status\n')).toBe('Git Status');
  });
});
