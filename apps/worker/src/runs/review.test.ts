import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AllowList } from '../paths/allowlist.js';
import { ProcessManager } from '../process/manager.js';
import {
  combineCommitMessages,
  COMMIT_INSTRUCTION,
  fallbackCommitMessage,
  parseCommitMessage,
} from './commit-message.js';
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
  fs.writeFile(path.join(wt.top, name), text);

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

  it('instruksi: ringkasan berbahasa Indonesia, identifier tidak dikecilkan', () => {
    expect(COMMIT_INSTRUCTION).not.toContain('huruf kecil>');
    expect(COMMIT_INSTRUCTION).toContain('bahasa Indonesia');
    expect(COMMIT_INSTRUCTION).toContain('formatPrice');
  });

  it('identifier dan nama berkas dipertahankan apa adanya', () => {
    expect(parseCommitMessage('Commit: feat(format): tambahkan formatPrice di page-count.ts')).toBe(
      'feat(format): tambahkan formatPrice di page-count.ts',
    );
    expect(fallbackCommitMessage('PageCount kini menolak nilai negatif.', ['src/a.ts'])).toBe(
      'chore: PageCount kini menolak nilai negatif',
    );
    expect(fallbackCommitMessage('README diperbarui', ['src/a.ts'])).toBe('chore: README diperbarui');
  });

  it('huruf non-Latin ditolak: baris Commit dilewati, fallback melewati baris itu', () => {
    expect(parseCommitMessage('Commit: feat(format): tambahkan formatter jumlah товара')).toBe(
      undefined,
    );
    expect(parseCommitMessage('Commit: fix: perbaiki 数量')).toBeUndefined();
    expect(parseCommitMessage('Commit: fix: perbaiki عدد')).toBeUndefined();
    // Baris sah sebelumnya tetap dipakai; tanda baca, angka, dan simbol tidak dianggap huruf asing.
    expect(
      parseCommitMessage('Commit: fix: perbaiki `page < 1` (#12) → 1\nCommit: fix: jumlah товара'),
    ).toBe('fix: perbaiki `page < 1` (#12) → 1');
    expect(fallbackCommitMessage('Добавлен форматтер\nTambah formatter jumlah.', ['a.ts'])).toBe(
      'chore: tambah formatter jumlah',
    );
    expect(fallbackCommitMessage('Готово', ['a.ts'])).toBe('chore: perubahan dari agent');
  });

  it('gabungan multi-run: type/scope run pertama, ringkasan semua run, duplikat dibuang', () => {
    expect(combineCommitMessages([])).toBeUndefined();
    expect(combineCommitMessages(['feat(price): tambahkan formatPrice'])).toBe(
      'feat(price): tambahkan formatPrice',
    );
    expect(
      combineCommitMessages([
        'feat(price): tambahkan formatPrice',
        'fix(price): perbaiki pembulatan',
        'feat(price): tambahkan formatPrice',
      ]),
    ).toBe('feat(price): tambahkan formatPrice; perbaiki pembulatan');
  });

  it('gabungan multi-run tidak melebihi 200 karakter dan tidak memotong kata', () => {
    const long = (n: number) => `fix: ${'perbaiki '.repeat(8)}bagian ${n}`;
    const message = combineCommitMessages([1, 2, 3, 4].map(long)) ?? '';
    expect(message.length).toBeLessThanOrEqual(200);
    expect(message).toBe(`${long(1)}; ${long(2).slice(5)}`);
    expect(message).not.toContain('\n');
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
    await fs.rm(path.join(wt.top, 'lama.txt'));
    await fs.rename(path.join(wt.top, 'README.md'), path.join(wt.top, 'BACA.md'));

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
    await fs.writeFile(path.join(wt.top, 'g.bin'), Buffer.from([0, 1, 2, 0, 255, 0]));
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
    const gitDir = git(wt.top, 'rev-parse', '--absolute-git-dir');
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
    expect(git(wt.top, 'rev-parse', 'HEAD')).toBe(wt.base);
    expect(git(repo, 'branch', '--list', 'aios/*')).toContain(wt.branch);
    expect(git(repo, 'log', '--oneline', wt.branch)).not.toContain('write a.txt');
  });

  it('undo ke checkpoint mengembalikan isi, menghapus berkas yang dibuat sesudahnya, dan membuang checkpoint berikutnya', async () => {
    const wt = await manager.create(RUN, repo);
    await write(wt, 'a.txt', '1\n');
    const first = await review.checkpoint(RUN, 'langkah 1');
    await write(wt, 'a.txt', '2\n');
    await write(wt, 'b.txt', 'baru\n');
    await fs.rm(path.join(wt.top, 'lama.txt'));
    await review.checkpoint(RUN, 'langkah 2');

    const state = await review.undo(RUN, first?.id ?? '');

    expect((await fs.readFile(path.join(wt.top, 'a.txt'), 'utf8')).trim()).toBe('1');
    await expect(fs.stat(path.join(wt.top, 'b.txt'))).rejects.toThrow();
    expect((await fs.readFile(path.join(wt.top, 'lama.txt'), 'utf8')).trim()).toBe('isi lama');
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
    expect(git(wt.top, 'status', '--porcelain')).toBe('');
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
    await fs.rm(path.join(wt.top, 'lama.txt'));
    await write(wt, 'baru.txt', 'x\n');

    await review.revertFile(RUN, 'math.js');
    await review.revertFile(RUN, 'lama.txt');
    const state = await review.revertFile(RUN, 'baru.txt');

    expect(state.files).toEqual([]);
    expect(await fs.readFile(path.join(wt.top, 'math.js'), 'utf8')).toContain('a + b');
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
    await expect(fs.stat(wt.top)).rejects.toThrow();
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

  it('merge dilewati dengan alasan jelas: working tree kotor, detached HEAD, rebase bentrok', async () => {
    await work();
    await fs.writeFile(path.join(repo, 'math.js'), 'ubahan pengguna\n');
    const dirty = await review.accept(RUN, { merge: true });
    expect(dirty).toMatchObject({ merged: false, mergeSkipped: 'dirty' });
    expect(git(repo, 'branch', '--list', dirty.branch)).not.toBe('');
    expect(await fs.readFile(path.join(repo, 'math.js'), 'utf8')).toBe('ubahan pengguna\n');
    git(repo, 'checkout', '-q', '--', 'math.js');

    // Branch pengguna maju dan menyentuh baris yang sama: rebase bentrok, dibatalkan, branch hasil utuh.
    const wt2 = await work(RUN_2);
    await write(wt2, 'math.js', 'export const add = (a, b) => b + a;\n');
    await fs.writeFile(path.join(repo, 'math.js'), 'export const add = (x, y) => x + y;\n');
    git(repo, 'commit', '-qam', 'main maju');
    const mainBefore = git(repo, 'rev-parse', 'main');
    const conflict = await review.accept(RUN_2, { merge: true });
    expect(conflict).toMatchObject({ merged: false, mergeSkipped: 'conflict' });
    expect(git(repo, 'rev-parse', 'main')).toBe(mainBefore);
    expect(git(repo, 'status', '--porcelain')).toBe('');
    expect(git(repo, 'show', `${conflict.branch}:math.js`)).toBe(
      'export const add = (a, b) => b + a;',
    );

    const third = '0192f0c4-7a1b-7c2d-aaaa-4a5b6c7d8e91';
    await work(third);
    git(repo, 'checkout', '-q', '--detach');
    const detached = await review.accept(third, { merge: true });
    expect(detached).toMatchObject({ merged: false, mergeSkipped: 'detached' });
  });

  it('terima + merge saat branch pengguna sudah maju: hasil di-rebase ke atasnya lalu fast-forward', async () => {
    const wt = await work();
    review.setMeta(RUN, 'Commit: test: tambah tes');
    await fs.writeFile(path.join(repo, 'baru-di-main.txt'), 'x');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'main maju');
    const ownerCommit = git(repo, 'rev-parse', 'main');

    const outcome = await review.accept(RUN, { merge: true });

    expect(outcome).toMatchObject({ merged: true, mergeSkipped: null });
    expect(git(repo, 'log', '--format=%s', '-2', 'main')).toBe('test: tambah tes\nmain maju');
    expect(git(repo, 'rev-parse', 'main~1')).toBe(ownerCommit);
    expect(outcome.commit).toBe(git(repo, 'rev-parse', 'main'));
    expect(git(repo, 'branch', '--list', wt.branch)).toBe('');
    expect(git(repo, 'status', '--porcelain')).toBe('');
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

    await expect(fs.stat(wt.top)).rejects.toThrow();
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
    expect(git(wt.top, 'status', '--porcelain')).toContain('math.test.js');
  });
});

describe('adopt (run lanjutan)', () => {
  it('run lanjutan memakai worktree, branch, base, dan checkpoint run sebelumnya', async () => {
    const wt = await manager.create(RUN, repo);
    await write(wt, 'a.txt', '1\n');
    await review.checkpoint(RUN, 'langkah 1');

    const adopted = await manager.adopt(RUN, RUN_2);
    await fs.writeFile(path.join(adopted.top, 'a.txt'), '2\n');
    await review.checkpoint(RUN_2, 'revisi');

    expect(adopted).toMatchObject({ top: wt.top, branch: wt.branch, base: wt.base });
    expect(manager.get(RUN)).toBeUndefined();
    const state = await review.get(RUN_2);
    expect(state.checkpoints.map((c) => c.label)).toEqual(['langkah 1', 'revisi']);
    await expect(manager.adopt(RUN, '0192f0c4-7a1b-7c2d-bbbb-4a5b6c7d8e91')).rejects.toThrow(
      /sudah tidak ada/,
    );
  });
});

describe('ReviewService: mode in_place (langsung di branch aktif)', () => {
  async function inPlace(runId = RUN) {
    // node_modules dan build/ diabaikan git: tidak boleh pernah disentuh tinjauan.
    await fs.writeFile(path.join(repo, '.gitignore'), 'node_modules/\nbuild/\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'abaikan');
    await fs.mkdir(path.join(repo, 'node_modules', 'lib'), { recursive: true });
    await fs.writeFile(path.join(repo, 'node_modules', 'lib', 'index.js'), 'modul\n');
    await fs.mkdir(path.join(repo, 'build'));
    await fs.writeFile(path.join(repo, 'build', 'out.js'), 'hasil build\n');
    return manager.openInPlace(runId, repo);
  }
  const read = (name: string) => fs.readFile(path.join(repo, name), 'utf8');

  it('diff terhadap base di folder project; terima = satu commit di branch aktif, tanpa branch aios', async () => {
    const ws = await inPlace();
    expect(ws).toMatchObject({ kind: 'in_place', top: repo, branch: 'main' });
    const base = git(repo, 'rev-parse', 'HEAD');
    await fs.writeFile(path.join(repo, 'math.js'), 'export const add = (a, b) => b + a;\n');
    await fs.mkdir(path.join(repo, 'src'));
    await fs.writeFile(path.join(repo, 'src', 'baru.js'), 'baru\n');
    await review.checkpoint(RUN, 'langkah');
    review.setMeta(RUN, 'Commit: feat: ubah add');

    const state = await review.get(RUN);
    expect(state).toMatchObject({ workspace: 'in_place', branch: 'main', base, headMoved: null });
    expect(state.files.map((f) => f.path).sort()).toEqual(['math.js', 'src/baru.js']);
    // Index pemilik tidak disentuh selama membaca diff.
    expect(git(repo, 'diff', '--cached', '--name-only')).toBe('');

    const outcome = await review.accept(RUN, { merge: false });

    expect(outcome).toMatchObject({ branch: 'main', merged: false, mergeSkipped: null });
    expect(git(repo, 'rev-parse', 'main')).toBe(outcome.commit);
    expect(git(repo, 'rev-parse', 'main~1')).toBe(base);
    expect(git(repo, 'log', '-1', '--format=%s')).toBe('feat: ubah add');
    expect(git(repo, 'branch', '--list', 'aios/*')).toBe('');
    expect(git(repo, 'status', '--porcelain')).toBe('');
    expect(git(repo, 'for-each-ref', 'refs/aios/')).toBe('');
    expect(await read('node_modules/lib/index.js')).toBe('modul\n');
    expect(manager.get(RUN)).toBeUndefined();
  });

  it('tolak: isi base kembali persis, hanya berkas buatan run dihapus, berkas yang diabaikan git utuh', async () => {
    await inPlace();
    const base = git(repo, 'rev-parse', 'HEAD');
    const before = await read('math.js');
    await fs.writeFile(path.join(repo, 'math.js'), 'rusak\n');
    await fs.rm(path.join(repo, 'lama.txt'));
    await fs.mkdir(path.join(repo, 'src', 'dalam'), { recursive: true });
    await fs.writeFile(path.join(repo, 'src', 'dalam', 'baru.js'), 'baru\n');
    await fs.writeFile(path.join(repo, 'build', 'out.js'), 'build diubah run\n');
    await fs.writeFile(path.join(repo, 'node_modules', 'lib', 'tambahan.js'), 'x\n');
    // Agent sempat men-stage sesuatu di index pemilik.
    git(repo, 'add', 'math.js');
    await review.checkpoint(RUN, 'langkah');

    await review.reject(RUN);

    expect(await read('math.js')).toBe(before);
    expect(await read('lama.txt')).toBe('isi lama\n');
    await expect(fs.stat(path.join(repo, 'src'))).rejects.toThrow();
    expect(await read('build/out.js')).toBe('build diubah run\n');
    expect(await read('node_modules/lib/index.js')).toBe('modul\n');
    expect(await read('node_modules/lib/tambahan.js')).toBe('x\n');
    expect(git(repo, 'status', '--porcelain')).toBe('');
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(base);
    expect(git(repo, 'branch', '--list', 'main')).not.toBe('');
    expect(git(repo, 'for-each-ref', 'refs/aios/')).toBe('');
  });

  it('tolak: agent membuka .gitignore tetap tidak membuat node_modules terhapus', async () => {
    await inPlace();
    await fs.writeFile(path.join(repo, '.gitignore'), 'build/\n');
    await fs.writeFile(path.join(repo, 'baru.txt'), 'baru\n');

    await review.reject(RUN);

    expect(await read('.gitignore')).toBe('node_modules/\nbuild/\n');
    expect(await read('node_modules/lib/index.js')).toBe('modul\n');
    await expect(fs.stat(path.join(repo, 'baru.txt'))).rejects.toThrow();
    expect(git(repo, 'status', '--porcelain')).toBe('');
  });

  it('undo ke checkpoint dan ke base di folder project', async () => {
    await inPlace();
    await fs.writeFile(path.join(repo, 'a.txt'), '1\n');
    const first = await review.checkpoint(RUN, 'satu');
    await fs.writeFile(path.join(repo, 'a.txt'), '2\n');
    await fs.writeFile(path.join(repo, 'b.txt'), 'b\n');
    await review.checkpoint(RUN, 'dua');

    const state = await review.undo(RUN, first!.id);
    expect(state.checkpoints.map((c) => c.label)).toEqual(['satu']);
    expect(await read('a.txt')).toBe('1\n');
    await expect(fs.stat(path.join(repo, 'b.txt'))).rejects.toThrow();

    await review.undo(RUN, 'base');
    expect(git(repo, 'status', '--porcelain')).toBe('');
    expect(await read('node_modules/lib/index.js')).toBe('modul\n');
  });

  it('HEAD maju selama run: terima di atas HEAD terbaru, tolak membuang yang belum di-commit saja', async () => {
    await inPlace();
    await fs.writeFile(path.join(repo, 'math.js'), 'diubah run\n');
    // Pemilik (atau agent) meng-commit berkas lain di branch yang sama selama run.
    await fs.writeFile(path.join(repo, 'catatan.txt'), 'pemilik\n');
    git(repo, 'add', 'catatan.txt');
    git(repo, 'commit', '-q', '-m', 'commit pemilik');
    const ownerCommit = git(repo, 'rev-parse', 'HEAD');

    const state = await review.get(RUN);
    expect(state.headMoved).toMatchObject({ state: 'advanced', commits: 1, branch: 'main' });
    await expect(review.undo(RUN, 'base')).rejects.toMatchObject({ code: 'head_moved' });

    const outcome = await review.accept(RUN, { merge: false });
    expect(git(repo, 'rev-parse', 'HEAD~1')).toBe(ownerCommit);
    expect(git(repo, 'show', '--name-only', '--format=', 'HEAD')).toBe('math.js');
    expect(outcome.commit).toBe(git(repo, 'rev-parse', 'HEAD'));

    await manager.openInPlace(RUN_2, repo);
    await fs.writeFile(path.join(repo, 'lama.txt'), 'diubah run 2\n');
    git(repo, 'commit', '-qam', 'agent sempat commit');
    await fs.writeFile(path.join(repo, 'README.md'), 'belum di-commit\n');
    const head = git(repo, 'rev-parse', 'HEAD');
    await review.reject(RUN_2);
    // Commit tidak dibatalkan (riwayat tidak ditulis ulang); perubahan yang belum di-commit dibuang.
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(head);
    expect(await read('README.md')).toBe('halo\n');
    expect(git(repo, 'status', '--porcelain')).toBe('');
  });

  it('beberapa run di tinjauan yang sama: pesan usulan menggabungkan semua run', async () => {
    await inPlace();
    await fs.writeFile(path.join(repo, 'math.js'), 'run 1\n');
    review.setMeta(RUN, 'Selesai.\nCommit: feat(math): tambahkan formatPrice');
    await manager.adopt(RUN, RUN_2);
    review.inherit(RUN, RUN_2);
    await fs.writeFile(path.join(repo, 'lama.txt'), 'run 2\n');
    review.setMeta(RUN_2, 'Commit: fix(math): perbaiki pageCount negatif');

    expect((await review.get(RUN_2)).commitMessage).toBe(
      'feat(math): tambahkan formatPrice; perbaiki pageCount negatif',
    );
    await review.accept(RUN_2, { merge: false });
    expect(git(repo, 'log', '-1', '--format=%s')).toBe(
      'feat(math): tambahkan formatPrice; perbaiki pageCount negatif',
    );
  });

  it('branch berganti selama run: terima dan tolak ditolak dengan head_moved, tidak ada yang diubah', async () => {
    await inPlace();
    await fs.writeFile(path.join(repo, 'math.js'), 'diubah run\n');
    git(repo, 'checkout', '-q', '-b', 'lain');

    const state = await review.get(RUN);
    expect(state.headMoved).toMatchObject({ state: 'switched', branch: 'lain' });
    await expect(review.accept(RUN, { merge: false })).rejects.toMatchObject({
      code: 'head_moved',
    });
    await expect(review.reject(RUN)).rejects.toMatchObject({ code: 'head_moved' });
    expect(await read('math.js')).toBe('diubah run\n');
    expect(manager.get(RUN)).toBeDefined();

    git(repo, 'checkout', '-q', 'main');
    await review.reject(RUN);
    expect(git(repo, 'status', '--porcelain')).toBe('');
  });
});
