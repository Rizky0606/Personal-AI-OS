import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AllowList } from '../paths/allowlist.js';
import { ProcessManager } from '../process/manager.js';
import { fallbackCommitMessage, parseCommitMessage } from './commit-message.js';
import { parseNameStatus, parseNumstat, ReviewError, ReviewService } from './review.js';
import { WorktreeManager, type Worktree } from './worktree.js';

const RUN = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';
const RUN_2 = '0192f0c4-7a1b-7c2d-9e3f-4a5b6c7d8e90';

let base: string;
let repo: string;
let manager: WorktreeManager;
let review: ReviewService;
let working = false;

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd,
    encoding: 'utf8',
  }).trim();
const write = (wt: Worktree, name: string, text: string) =>
  fs.writeFile(path.join(wt.root, name), text);

beforeEach(async () => {
  working = false;
  base = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'aios-rv-')));
  repo = path.join(base, 'izin', 'aplikasi');
  await fs.mkdir(repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  await fs.writeFile(path.join(repo, 'README.md'), 'halo\n');
  await fs.writeFile(path.join(repo, 'math.js'), 'export const add = (a, b) => a + b;\n');
  await fs.writeFile(path.join(repo, 'lama.txt'), 'isi lama\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'awal');
  const allowed = new AllowList({ file: path.join(base, 'data', 'allowed.json'), forbidden: [] });
  await allowed.add(path.join(base, 'izin'));
  const processes = new ProcessManager({
    checkCwd: (cwd) =>
      allowed.resolveDirectory(cwd).catch(() => {
        if (manager.contains(cwd)) return cwd;
        throw new Error('ditolak');
      }),
  });
  manager = new WorktreeManager({ processes, allowed, dataDir: path.join(base, 'data') });
  review = new ReviewService({ worktrees: manager, isWorking: () => working });
});
afterEach(async () => {
  for (let i = 0; i < 5; i++) {
    try {
      await fs.rm(base, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
});

describe('parser keluaran git', () => {
  it('name-status -z: modifikasi, tambah, hapus, rename', () => {
    const raw = 'M\0a.ts\0A\0b.ts\0D\0c.ts\0R087\0lama.ts\0baru.ts\0';
    expect(parseNameStatus(raw)).toEqual([
      { path: 'a.ts', status: 'modified' },
      { path: 'b.ts', status: 'added' },
      { path: 'c.ts', status: 'deleted' },
      { path: 'baru.ts', status: 'renamed', oldPath: 'lama.ts' },
    ]);
  });

  it('numstat -z: biner, rename, dan nama dengan spasi', () => {
    const raw = '3\t1\ta b.ts\0-\t-\tgambar.png\x000\t0\t\0lama.ts\0baru.ts\0';
    expect(parseNumstat(raw)).toEqual([
      { path: 'a b.ts', additions: 3, deletions: 1, binary: false },
      { path: 'gambar.png', additions: 0, deletions: 0, binary: true },
      { path: 'baru.ts', additions: 0, deletions: 0, binary: false },
    ]);
  });
});

describe('pesan commit', () => {
  it('mengambil baris "Commit:" terakhir yang berformat Conventional Commits', () => {
    const text = 'Selesai.\nCommit: asal-asalan\nCommit: test(math): tambah tes untuk add\n';
    expect(parseCommitMessage(text)).toBe('test(math): tambah tes untuk add');
    expect(parseCommitMessage('**Commit:** `fix: perbaiki off-by-one`')).toBe(
      'fix: perbaiki off-by-one',
    );
    expect(parseCommitMessage('Commit: tambah tes')).toBeUndefined();
    expect(parseCommitMessage('tanpa baris itu')).toBeUndefined();
  });

  it('fallback: tipe dari berkas yang berubah, ringkasan dari baris pertama', () => {
    expect(fallbackCommitMessage('Menambahkan tes untuk add.\nDetail.', ['math.test.js'])).toBe(
      'test: menambahkan tes untuk add',
    );
    expect(fallbackCommitMessage('# Perbarui panduan', ['README.md', 'docs/a.md'])).toBe(
      'docs: perbarui panduan',
    );
    expect(fallbackCommitMessage('', ['src/a.ts'])).toBe('chore: perubahan dari agent');
  });
});

describe('ReviewService: diff', () => {
  it('daftar file dengan status, tambah/hapus, dan patch; berkas baru (untracked) ikut', async () => {
    const wt = await manager.create(RUN, repo);
    await write(
      wt,
      'math.js',
      'export const add = (a, b) => a + b;\nexport const sub = (a, b) => a - b;\n',
    );
    await write(wt, 'math.test.js', 'import test from "node:test";\n');
    await fs.rm(path.join(wt.root, 'lama.txt'));
    await fs.rename(path.join(wt.root, 'README.md'), path.join(wt.root, 'BACA.md'));

    const state = await review.get(RUN);

    const byPath = Object.fromEntries(state.files.map((f) => [f.path, f]));
    expect(byPath['math.js']).toMatchObject({ status: 'modified', additions: 1, deletions: 0 });
    expect(byPath['math.js']?.patch).toContain('+export const sub');
    expect(byPath['math.test.js']).toMatchObject({ status: 'added', additions: 1 });
    expect(byPath['lama.txt']).toMatchObject({ status: 'deleted', deletions: 1 });
    expect(byPath['BACA.md']).toMatchObject({ status: 'renamed', oldPath: 'README.md' });
    expect(state.branch).toBe(wt.branch);
    expect(state.targetBranch).toBe('main');
    expect(state.base).toBe(wt.base);
    // Repo asli tidak tersentuh.
    expect(git(repo, 'status', '--porcelain')).toBe('');
  });

  it('berkas biner tanpa patch; patch sangat besar ditandai terpotong', async () => {
    const wt = await manager.create(RUN, repo);
    await fs.writeFile(path.join(wt.root, 'g.bin'), Buffer.from([0, 1, 2, 0, 255, 0]));
    await write(wt, 'besar.txt', 'baris panjang yang berulang\n'.repeat(20_000));

    const { files } = await review.get(RUN);

    const bin = files.find((f) => f.path === 'g.bin');
    expect(bin).toMatchObject({ binary: true, patch: '' });
    const big = files.find((f) => f.path === 'besar.txt');
    expect(big?.truncated).toBe(true);
    expect(big?.additions).toBe(20_000);
  });

  it('nama berkas dengan karakter khusus (spasi, kurung, tanda pagar) tetap dibaca benar', async () => {
    const wt = await manager.create(RUN, repo);
    await write(wt, 'a b (1) #x.txt', 'isi\n');

    const { files } = await review.get(RUN);

    expect(files.map((f) => f.path)).toEqual(['a b (1) #x.txt']);
    expect(files[0]?.patch).toContain('+isi');
  });

  it('membaca diff dan membuat checkpoint tetap jalan saat index worktree dikunci git lain (mis. milik agent)', async () => {
    const wt = await manager.create(RUN, repo);
    await write(wt, 'a.txt', 'satu');
    const gitDir = git(wt.root, 'rev-parse', '--absolute-git-dir');
    await fs.writeFile(path.join(gitDir, 'index.lock'), '');

    const state = await review.get(RUN);
    const created = await review.checkpoint(RUN, 'saat terkunci');

    expect(state.files.map((f) => f.path)).toEqual(['a.txt']);
    expect(created).not.toBeNull();
  });

  it('hasil yang sudah tidak ada: review_not_found', async () => {
    await expect(review.get(RUN)).rejects.toMatchObject({ code: 'review_not_found' });
  });
});

describe('ReviewService: checkpoint dan undo', () => {
  it('checkpoint hanya dibuat bila isi berubah; daftar berurutan; branch kerja tidak ikut ber-commit', async () => {
    const wt = await manager.create(RUN, repo);
    expect(await review.checkpoint(RUN, 'tidak ada perubahan')).toBeNull();

    await write(wt, 'a.txt', '1\n');
    const first = await review.checkpoint(RUN, 'write a.txt');
    expect(await review.checkpoint(RUN, 'sama saja')).toBeNull();
    await write(wt, 'a.txt', '2\n');
    const second = await review.checkpoint(RUN, 'edit a.txt');

    const state = await review.get(RUN);
    expect(state.checkpoints.map((c) => c.label)).toEqual(['write a.txt', 'edit a.txt']);
    expect(state.checkpoints.map((c) => c.id)).toEqual([first?.id, second?.id]);
    expect(git(wt.root, 'rev-parse', 'HEAD')).toBe(wt.base);
    expect(git(repo, 'branch', '--list', 'aios/*')).toContain(wt.branch);
    expect(git(repo, 'log', '--oneline', wt.branch)).not.toContain('write a.txt');
  });

  it('undo ke checkpoint mengembalikan isi, menghapus berkas yang dibuat sesudahnya, dan membuang checkpoint berikutnya', async () => {
    const wt = await manager.create(RUN, repo);
    await write(wt, 'a.txt', '1\n');
    const first = await review.checkpoint(RUN, 'langkah 1');
    await write(wt, 'a.txt', '2\n');
    await write(wt, 'b.txt', 'baru\n');
    await fs.rm(path.join(wt.root, 'lama.txt'));
    await review.checkpoint(RUN, 'langkah 2');

    const state = await review.undo(RUN, first?.id ?? '');

    expect((await fs.readFile(path.join(wt.root, 'a.txt'), 'utf8')).trim()).toBe('1');
    await expect(fs.stat(path.join(wt.root, 'b.txt'))).rejects.toThrow();
    expect((await fs.readFile(path.join(wt.root, 'lama.txt'), 'utf8')).trim()).toBe('isi lama');
    expect(state.checkpoints.map((c) => c.label)).toEqual(['langkah 1']);
    expect(state.files.map((f) => f.path)).toEqual(['a.txt']);
  });

  it('undo ke base mengosongkan semua perubahan agent', async () => {
    const wt = await manager.create(RUN, repo);
    await write(wt, 'a.txt', '1\n');
    await write(wt, 'math.js', 'rusak\n');
    await review.checkpoint(RUN, 'langkah 1');

    const state = await review.undo(RUN, 'base');

    expect(state.files).toEqual([]);
    expect(state.checkpoints).toEqual([]);
    expect(git(wt.root, 'status', '--porcelain')).toBe('');
  });

  it('checkpoint tak dikenal ditolak; run yang masih bekerja tidak boleh di-undo', async () => {
    const wt = await manager.create(RUN, repo);
    await write(wt, 'a.txt', '1\n');
    await review.checkpoint(RUN, 'langkah 1');

    await expect(review.undo(RUN, 'bukan-checkpoint')).rejects.toMatchObject({
      code: 'review_not_found',
    });
    working = true;
    await expect(review.undo(RUN, 'base')).rejects.toBeInstanceOf(ReviewError);
    await expect(review.undo(RUN, 'base')).rejects.toMatchObject({ code: 'run_active' });
  });

  it('revertFile: memulihkan berkas dimodifikasi, dihapus, dan menghapus berkas baru', async () => {
    const wt = await manager.create(RUN, repo);
    await write(wt, 'math.js', 'rusak\n');
    await fs.rm(path.join(wt.root, 'lama.txt'));
    await write(wt, 'baru.txt', 'x\n');

    await review.revertFile(RUN, 'math.js');
    await review.revertFile(RUN, 'lama.txt');
    const state = await review.revertFile(RUN, 'baru.txt');

    expect(state.files).toEqual([]);
    expect(await fs.readFile(path.join(wt.root, 'math.js'), 'utf8')).toContain('a + b');
    await expect(review.revertFile(RUN, 'tidak-ada.txt')).rejects.toMatchObject({
      code: 'review_not_found',
    });
  });
});

describe('ReviewService: terima dan tolak', () => {
  async function work(runId = RUN) {
    const wt = await manager.create(runId, repo);
    await write(wt, 'math.test.js', 'tes\n');
    return wt;
  }

  it('terima: satu commit dengan pesan buatan agent di branch kerja; branch kerja pengguna tidak berubah', async () => {
    const wt = await work();
    const mainBefore = git(repo, 'rev-parse', 'main');
    await review.checkpoint(RUN, 'write');
    review.setMeta(RUN, 'Selesai.\nCommit: test: tambah tes untuk add');

    const outcome = await review.accept(RUN, { merge: false });

    expect(outcome).toMatchObject({ branch: wt.branch, merged: false, mergeSkipped: null });
    expect(git(repo, 'log', '-1', '--format=%s', wt.branch)).toBe('test: tambah tes untuk add');
    expect(git(repo, 'rev-parse', wt.branch)).toBe(outcome.commit);
    expect(git(repo, 'rev-parse', 'main')).toBe(mainBefore);
    expect(git(repo, 'status', '--porcelain')).toBe('');
    expect(git(repo, 'rev-list', '--count', `main..${wt.branch}`)).toBe('1');
    await expect(fs.stat(wt.root)).rejects.toThrow();
    expect(git(repo, 'for-each-ref', 'refs/aios/')).toBe('');
  });

  it('pesan commit dari pengguna menggantikan buatan agent; tanpa keduanya, fallback', async () => {
    await work();
    review.setMeta(RUN, 'Commit: test: dari agent');
    const a = await review.accept(RUN, { merge: false, commitMessage: 'fix: dari pengguna' });
    expect(git(repo, 'log', '-1', '--format=%s', a.branch)).toBe('fix: dari pengguna');

    await work(RUN_2);
    review.setMeta(RUN_2, 'Menambahkan tes untuk add.');
    const b = await review.accept(RUN_2, { merge: false });
    expect(git(repo, 'log', '-1', '--format=%s', b.branch)).toBe('test: menambahkan tes untuk add');
  });

  it('terima + merge: fast-forward ke branch kerja pengguna, branch sementara dihapus', async () => {
    const wt = await work();
    review.setMeta(RUN, 'Commit: test: tambah tes');

    const outcome = await review.accept(RUN, { merge: true });

    expect(outcome).toMatchObject({ merged: true, mergeSkipped: null });
    expect(git(repo, 'log', '-1', '--format=%s', 'main')).toBe('test: tambah tes');
    expect((await fs.readFile(path.join(repo, 'math.test.js'), 'utf8')).trim()).toBe('tes');
    expect(git(repo, 'branch', '--list', wt.branch)).toBe('');
  });

  it('merge dilewati dengan alasan jelas: working tree kotor, detached HEAD, bukan fast-forward', async () => {
    await work();
    await fs.writeFile(path.join(repo, 'math.js'), 'ubahan pengguna\n');
    const dirty = await review.accept(RUN, { merge: true });
    expect(dirty).toMatchObject({ merged: false, mergeSkipped: 'dirty' });
    expect(git(repo, 'branch', '--list', dirty.branch)).not.toBe('');
    expect(await fs.readFile(path.join(repo, 'math.js'), 'utf8')).toBe('ubahan pengguna\n');
    git(repo, 'checkout', '-q', '--', 'math.js');

    await work(RUN_2);
    await fs.writeFile(path.join(repo, 'baru-di-main.txt'), 'x');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'main maju');
    const diverged = await review.accept(RUN_2, { merge: true });
    expect(diverged).toMatchObject({ merged: false, mergeSkipped: 'not_fast_forward' });

    const third = '0192f0c4-7a1b-7c2d-aaaa-4a5b6c7d8e91';
    await work(third);
    git(repo, 'checkout', '-q', '--detach');
    const detached = await review.accept(third, { merge: true });
    expect(detached).toMatchObject({ merged: false, mergeSkipped: 'detached' });
  });

  it('terima tanpa perubahan (setelah undo ke base): tidak ada commit, branch dibuang', async () => {
    const wt = await work();
    await review.checkpoint(RUN, 'langkah');
    await review.undo(RUN, 'base');

    const outcome = await review.accept(RUN, { merge: true });

    expect(outcome).toMatchObject({
      commit: null,
      merged: false,
      mergeSkipped: 'nothing_to_merge',
    });
    expect(git(repo, 'branch', '--list', wt.branch)).toBe('');
  });

  it('tolak: worktree, branch, dan checkpoint dibuang; repo asli utuh', async () => {
    const wt = await work();
    await review.checkpoint(RUN, 'langkah');
    const headBefore = git(repo, 'rev-parse', 'HEAD');

    await review.reject(RUN);

    await expect(fs.stat(wt.root)).rejects.toThrow();
    expect(git(repo, 'branch', '--list', wt.branch)).toBe('');
    expect(git(repo, 'for-each-ref', 'refs/aios/')).toBe('');
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(headBefore);
    expect(git(repo, 'status', '--porcelain')).toBe('');
  });

  it('terima/tolak ditolak selama run masih bekerja', async () => {
    await work();
    working = true;
    await expect(review.accept(RUN, { merge: false })).rejects.toMatchObject({
      code: 'run_active',
    });
    await expect(review.reject(RUN)).rejects.toMatchObject({ code: 'run_active' });
  });

  it('operasi bersamaan pada satu run tidak saling menyalip', async () => {
    const wt = await work();
    const results = await Promise.all([
      review.checkpoint(RUN, 'a'),
      review.get(RUN),
      review.checkpoint(RUN, 'b'),
      review.stat(RUN),
    ]);

    expect(results[0]).not.toBeNull();
    expect(results[2]).toBeNull(); // isi sama dengan checkpoint a
    expect(git(wt.root, 'status', '--porcelain')).toContain('math.test.js');
  });
});

describe('adopt (run lanjutan)', () => {
  it('run lanjutan memakai worktree, branch, base, dan checkpoint run sebelumnya', async () => {
    const wt = await manager.create(RUN, repo);
    await write(wt, 'a.txt', '1\n');
    await review.checkpoint(RUN, 'langkah 1');

    const adopted = manager.adopt(RUN, RUN_2);
    await fs.writeFile(path.join(adopted.root, 'a.txt'), '2\n');
    await review.checkpoint(RUN_2, 'revisi');

    expect(adopted).toMatchObject({ root: wt.root, branch: wt.branch, base: wt.base });
    expect(manager.get(RUN)).toBeUndefined();
    const state = await review.get(RUN_2);
    expect(state.checkpoints.map((c) => c.label)).toEqual(['langkah 1', 'revisi']);
    expect(() => manager.adopt(RUN, '0192f0c4-7a1b-7c2d-bbbb-4a5b6c7d8e91')).toThrow(
      /sudah tidak ada/,
    );
  });
});
