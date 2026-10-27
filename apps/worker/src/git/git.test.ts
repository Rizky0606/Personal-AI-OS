import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PathError } from '../paths/normalize.js';
import { ProcessManager } from '../process/manager.js';
import { GitActionError, createGitService, parseBranchLine, parseEntry, scrub } from './service.js';

const run = promisify(execFile);
const TARGET = { projectId: '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f' };
let dir: string;

const sh = (...args: string[]) =>
  run('git', ['-c', 'user.name=Uji', '-c', 'user.email=uji@example.com', ...args], { cwd: dir });
const w = async (rel: string, data: string | Buffer) => {
  await mkdir(nodePath.dirname(nodePath.join(dir, rel)), { recursive: true });
  await writeFile(nodePath.join(dir, rel), data);
};
/** Isi berkas dengan akhir baris dinormalkan (git di Windows bisa menulis CRLF). */
const text = async (rel: string) =>
  (await readFile(nodePath.join(dir, rel), 'utf8')).replace(/\r\n/g, '\n');
const service = () =>
  createGitService({
    resolve: () => Promise.resolve({ cwd: dir }),
    processes: new ProcessManager(),
  });

beforeEach(async () => {
  dir = await mkdtemp(nodePath.join(tmpdir(), 'git-root-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function repoWithCommit() {
  await sh('init', '-q', '-b', 'main');
  await w('src/a.ts', 'export const a = 1;\n');
  await w('README.md', '# hai\n');
  await sh('add', '-A');
  await sh('commit', '-q', '-m', 'feat: awal');
}

describe('parser', () => {
  it('baris branch: upstream, ahead/behind, HEAD lepas, repo baru', () => {
    expect(parseBranchLine('## main...origin/main [ahead 2, behind 1]')).toEqual({
      branch: 'main',
      upstream: 'origin/main',
      ahead: 2,
      behind: 1,
    });
    expect(parseBranchLine('## fitur')).toEqual({
      branch: 'fitur',
      upstream: null,
      ahead: 0,
      behind: 0,
    });
    expect(parseBranchLine('## HEAD (no branch)').branch).toBeNull();
    expect(parseBranchLine('## No commits yet on main').branch).toBe('main');
  });

  it('kode status menjadi status, staged, dan unstaged', () => {
    expect(parseEntry('??', 'baru.ts')).toMatchObject({ status: 'untracked', unstaged: true });
    expect(parseEntry('M ', 'a.ts')).toMatchObject({
      status: 'modified',
      staged: true,
      unstaged: false,
    });
    expect(parseEntry(' M', 'a.ts')).toMatchObject({
      status: 'modified',
      staged: false,
      unstaged: true,
    });
    expect(parseEntry('MM', 'a.ts')).toMatchObject({ staged: true, unstaged: true });
    expect(parseEntry('A ', 'b.ts')).toMatchObject({ status: 'added' });
    expect(parseEntry(' D', 'c.ts')).toMatchObject({ status: 'deleted' });
    expect(parseEntry('R ', 'baru.ts', 'lama.ts')).toMatchObject({
      status: 'renamed',
      oldPath: 'lama.ts',
    });
    expect(parseEntry('UU', 'x.ts')).toMatchObject({ status: 'conflicted' });
    expect(parseEntry('!!', 'ignored')).toBeNull();
  });
});

describe('git.status', () => {
  it('folder biasa bukan repo: isRepo false tanpa galat', async () => {
    expect(await service().status(TARGET)).toMatchObject({ isRepo: false, files: [] });
  });

  it('repo bersih: branch dan tanpa berkas; berubah: berkas dengan status, urut path', async () => {
    await repoWithCommit();
    expect(await service().status(TARGET)).toMatchObject({
      isRepo: true,
      branch: 'main',
      files: [],
      truncated: false,
    });

    await w('src/a.ts', 'export const a = 2;\n');
    await w('src/baru.ts', 'export {};\n');
    await sh('rm', '-q', 'README.md');
    const status = await service().status(TARGET);
    expect(status.files.map((f) => [f.path, f.status])).toEqual([
      ['README.md', 'deleted'],
      ['src/a.ts', 'modified'],
      ['src/baru.ts', 'untracked'],
    ]);
  });

  it('nama berkas dengan spasi dan huruf non-ASCII terbaca utuh', async () => {
    await repoWithCommit();
    await w('catatan penting é.txt', 'x');
    expect((await service().status(TARGET)).files.map((f) => f.path)).toContain(
      'catatan penting é.txt',
    );
  });

  it('ganti nama yang sudah di-stage membawa path lama', async () => {
    await repoWithCommit();
    await sh('mv', 'README.md', 'BACA.md');
    const file = (await service().status(TARGET)).files.find((f) => f.path === 'BACA.md');
    expect(file).toMatchObject({ status: 'renamed', oldPath: 'README.md', staged: true });
  });
});

describe('git.diff', () => {
  it('berkas terlacak: unified diff terhadap HEAD, termasuk yang sudah di-stage', async () => {
    await repoWithCommit();
    await w('src/a.ts', 'export const a = 2;\n');
    await sh('add', 'src/a.ts');
    const diff = await service().diff(TARGET, 'src/a.ts');
    expect(diff).toMatchObject({ path: 'src/a.ts', binary: false, truncated: false });
    expect(diff.patch).toContain('-export const a = 1;');
    expect(diff.patch).toContain('+export const a = 2;');
  });

  it('berkas baru yang belum dilacak tampil sebagai semua baris tambah', async () => {
    await repoWithCommit();
    await w('src/baru.ts', 'baris satu\nbaris dua\n');
    const diff = await service().diff(TARGET, 'src/baru.ts');
    expect(diff.patch).toContain('+baris satu');
    expect(diff.patch).toContain('+baris dua');
    expect(diff.patch).not.toContain('-baris');
  });

  it('berkas biner ditandai binary tanpa isi', async () => {
    await repoWithCommit();
    await w('gambar.bin', Buffer.from([0, 1, 2, 3, 0, 255, 0, 0]));
    expect(await service().diff(TARGET, 'gambar.bin')).toMatchObject({ binary: true, patch: '' });
  });

  it('patch besar dipotong; path di luar folder dan bukan repo ditolak', async () => {
    await repoWithCommit();
    await w('besar.txt', `${'x'.repeat(100)}\n`.repeat(5000));
    expect((await service().diff(TARGET, 'besar.txt')).truncated).toBe(true);
    for (const bad of ['../luar.txt', '/etc/passwd', 'C:\\x', '-p']) {
      await expect(service().diff(TARGET, bad)).rejects.toBeInstanceOf(PathError);
    }
  });

  it('folder bukan repo: ditolak jelas', async () => {
    await expect(service().diff(TARGET, 'a.ts')).rejects.toMatchObject({
      code: 'invalid_request',
    });
  });
});

describe('git.log', () => {
  it('commit terbaru dulu dengan hash, subjek, penulis, dan tanggal; dibatasi limit', async () => {
    await repoWithCommit();
    await w('src/a.ts', 'export const a = 3;\n');
    await sh('commit', '-q', '-am', 'fix: ubah nilai a');
    const { commits } = await service().log(TARGET, 1);
    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({ subject: 'fix: ubah nilai a', author: 'Uji' });
    expect(commits[0]?.hash).toMatch(/^[0-9a-f]{40}$/);
    expect(commits[0]?.date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect((await service().log(TARGET, 10)).commits.map((c) => c.subject)).toEqual([
      'fix: ubah nilai a',
      'feat: awal',
    ]);
  });

  it('repo tanpa commit: daftar kosong', async () => {
    await sh('init', '-q', '-b', 'main');
    expect(await service().log(TARGET, 5)).toEqual({ commits: [] });
  });
});

describe('aksi git', () => {
  const P = TARGET.projectId;
  const statusOf = async () => (await service().status(TARGET)).files;

  it('stage dan unstage: per berkas dan semua; tanpa pilihan ditolak', async () => {
    await repoWithCommit();
    await w('src/a.ts', 'export const a = 2;\n');
    await w('src/baru.ts', 'export {};\n');

    await service().stage(P, ['src/a.ts'], false);
    expect(await statusOf()).toMatchObject([
      { path: 'src/a.ts', staged: true },
      { path: 'src/baru.ts', status: 'untracked', staged: false },
    ]);

    await service().stage(P, [], true);
    expect((await statusOf()).every((f) => f.staged)).toBe(true);

    await service().unstage(P, ['src/a.ts'], false);
    expect((await statusOf()).find((f) => f.path === 'src/a.ts')).toMatchObject({
      staged: false,
      unstaged: true,
    });

    await service().unstage(P, [], true);
    expect((await statusOf()).some((f) => f.staged)).toBe(false);
    await expect(service().stage(P, [], false)).rejects.toBeInstanceOf(GitActionError);
    await expect(service().stage(P, ['../luar.txt'], false)).rejects.toBeInstanceOf(PathError);
  });

  it('unstage di repo tanpa commit mengeluarkan dari indeks', async () => {
    await sh('init', '-q', '-b', 'main');
    await w('a.txt', 'x');
    await service().stage(P, [], true);
    expect((await statusOf())[0]).toMatchObject({ status: 'added', staged: true });
    await service().unstage(P, [], true);
    expect((await statusOf())[0]).toMatchObject({ status: 'untracked' });
  });

  it('discard: berkas terlacak kembali ke HEAD (termasuk yang di-stage); berkas baru dihapus; folder lain aman', async () => {
    await repoWithCommit();
    await w('src/a.ts', 'export const a = 99;\n');
    await sh('add', 'src/a.ts');
    await w('src/baru.ts', 'sementara\n');
    await w('catatan/penting.txt', 'jangan hapus');

    await service().discard(P, 'src/a.ts');
    expect(await text('src/a.ts')).toBe('export const a = 1;\n');
    await service().discard(P, 'src/baru.ts');
    await expect(readFile(nodePath.join(dir, 'src/baru.ts'))).rejects.toThrow();
    expect(await readFile(nodePath.join(dir, 'catatan/penting.txt'), 'utf8')).toBe('jangan hapus');
    expect((await statusOf()).map((f) => f.path)).toEqual(['catatan/penting.txt']);
  });

  it('commit: butuh yang di-stage; hasilnya commit baru dengan pesan itu', async () => {
    await repoWithCommit();
    await expect(service().commit(P, 'feat: kosong')).rejects.toThrow(/Tidak ada perubahan/);

    await w('src/a.ts', 'export const a = 2;\n');
    await service().stage(P, ['src/a.ts'], false);
    const commit = await service().commit(P, 'fix: ubah nilai a\n\nDetail perubahan.');
    expect(commit).toMatchObject({ subject: 'fix: ubah nilai a' });
    expect(await statusOf()).toEqual([]);
    expect((await service().log(TARGET, 5)).commits.map((c) => c.subject)).toEqual([
      'fix: ubah nilai a',
      'feat: awal',
    ]);
  });

  it('commit pertama di repo tanpa commit berhasil; hook yang menolak mengembalikan pesannya', async () => {
    await sh('init', '-q', '-b', 'main');
    await w('a.txt', 'x');
    await service().stage(P, [], true);
    expect(await service().commit(P, 'feat: awal')).toMatchObject({ subject: 'feat: awal' });

    await w('b.txt', 'y');
    await service().stage(P, [], true);
    await mkdir(nodePath.join(dir, '.git/hooks'), { recursive: true });
    await writeFile(
      nodePath.join(dir, '.git/hooks/pre-commit'),
      '#!/bin/sh\necho "lint gagal: ada galat" >&2\nexit 1\n',
      { mode: 0o755 },
    );
    await expect(service().commit(P, 'feat: ditolak hook')).rejects.toThrow(/lint gagal/);
  });

  it('branches dan checkout: hanya branch lokal yang ada; nama aneh tidak pernah jadi opsi git', async () => {
    await repoWithCommit();
    await sh('branch', 'fitur-x');
    expect(await service().branches(P)).toMatchObject({ current: 'main' });
    expect((await service().branches(P)).branches.sort()).toEqual(['fitur-x', 'main']);

    await service().checkout(P, 'fitur-x');
    expect((await service().branches(P)).current).toBe('fitur-x');
    await expect(service().checkout(P, 'tidak-ada')).rejects.toBeInstanceOf(GitActionError);
    await expect(service().checkout(P, '--orphan=x')).rejects.toBeInstanceOf(GitActionError);
  });

  it('checkout yang bentrok dengan perubahan lokal ditolak git dengan pesannya', async () => {
    await repoWithCommit();
    await sh('checkout', '-q', '-b', 'lain');
    await w('src/a.ts', 'export const a = 5;\n');
    await sh('commit', '-q', '-am', 'fix: a');
    await sh('checkout', '-q', 'main');
    await w('src/a.ts', 'export const a = 7;\n');
    await expect(service().checkout(P, 'lain')).rejects.toThrow(/overwritten|local changes/i);
  });

  describe('dengan remote', () => {
    let remote: string;
    beforeEach(async () => {
      remote = await mkdtemp(nodePath.join(tmpdir(), 'git-remote-'));
      await run('git', ['init', '-q', '--bare', '-b', 'main'], { cwd: remote });
    });
    afterEach(async () => {
      await rm(remote, { recursive: true, force: true });
    });

    it('push tanpa upstream membuat upstream ke origin; pull --ff-only membawa commit orang lain', async () => {
      await repoWithCommit();
      await expect(service().push(P)).rejects.toThrow(/belum punya remote/);
      await sh('remote', 'add', 'origin', remote);

      await service().push(P);
      expect((await service().status(TARGET)).upstream).toBe('origin/main');

      // Orang lain menambah commit di remote.
      const other = await mkdtemp(nodePath.join(tmpdir(), 'git-other-'));
      try {
        await run('git', ['clone', '-q', remote, other]);
        await writeFile(nodePath.join(other, 'baru.txt'), 'dari tim\n');
        const g = (...a: string[]) =>
          run('git', ['-c', 'user.name=Tim', '-c', 'user.email=tim@example.com', ...a], {
            cwd: other,
          });
        await g('add', '-A');
        await g('commit', '-q', '-m', 'feat: dari tim');
        await g('push', '-q');
      } finally {
        await rm(other, { recursive: true, force: true });
      }

      await service().pull(P);
      expect((await service().log(TARGET, 1)).commits[0]?.subject).toBe('feat: dari tim');
      expect(await text('baru.txt')).toBe('dari tim\n');
    });

    it('push dengan HEAD lepas ditolak; pesan galat tidak membocorkan kredensial di URL', async () => {
      await repoWithCommit();
      await sh('remote', 'add', 'origin', remote);
      await sh('checkout', '-q', '--detach');
      await expect(service().push(P)).rejects.toThrow(/HEAD lepas/);

      await sh('checkout', '-q', 'main');
      await sh('remote', 'set-url', 'origin', 'https://pengguna:rahasia123@localhost:9/repo.git');
      const error = await service()
        .push(P)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(GitActionError);
      expect((error as Error).message).not.toContain('rahasia123');
    });
  });
});

describe('scrub', () => {
  it('membuang kredensial di URL', () => {
    expect(scrub("fatal: unable to access 'https://u:tok@host/x.git/'")).toBe(
      "fatal: unable to access 'https://***@host/x.git/'",
    );
  });
});
