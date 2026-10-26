import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PathError } from '../paths/normalize.js';
import { MAX_ENTRIES, MAX_TEXT_BYTES, createFilesService } from './service.js';

const TARGET = { projectId: '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f' };
let dir: string;
let outside: string;

beforeEach(async () => {
  dir = await mkdtemp(nodePath.join(tmpdir(), 'files-root-'));
  outside = await mkdtemp(nodePath.join(tmpdir(), 'files-out-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

const service = () => createFilesService({ resolve: () => Promise.resolve({ cwd: dir }) });
const w = (rel: string, data: string | Buffer) =>
  mkdir(nodePath.dirname(nodePath.join(dir, rel)), { recursive: true }).then(() =>
    writeFile(nodePath.join(dir, rel), data),
  );

describe('files.list', () => {
  it('folder dulu, lalu berkas, urut nama; .git dan node_modules disembunyikan', async () => {
    await w('src/App.tsx', 'x');
    await w('README.md', '# hai');
    await w('b.txt', 'bb');
    await w('.git/config', 'rahasia');
    await w('node_modules/x/index.js', 'x');

    const root = await service().list(TARGET, '');
    expect(root.entries.map((e) => [e.name, e.kind])).toEqual([
      ['src', 'dir'],
      ['b.txt', 'file'],
      ['README.md', 'file'],
    ]);
    expect(root.entries.find((e) => e.name === 'b.txt')?.size).toBe(2);

    const src = await service().list(TARGET, 'src');
    expect(src).toMatchObject({ path: 'src', truncated: false });
    expect(src.entries[0]).toMatchObject({ name: 'App.tsx', path: 'src/App.tsx' });
  });

  it(`memotong isi folder di ${MAX_ENTRIES} entri`, async () => {
    await mkdir(nodePath.join(dir, 'banyak'));
    for (let i = 0; i < MAX_ENTRIES + 5; i++) await w(`banyak/f${i}.txt`, '');
    const list = await service().list(TARGET, 'banyak');
    expect(list.entries).toHaveLength(MAX_ENTRIES);
    expect(list.truncated).toBe(true);
  });
});

describe('files.read', () => {
  it('teks dibaca penuh; teks besar dipotong; biner tidak ditampilkan', async () => {
    await w('a.ts', 'const a = 1;\n');
    await w('besar.txt', 'x'.repeat(MAX_TEXT_BYTES + 10));
    await w('data.bin', Buffer.from([1, 2, 0, 3]));

    expect(await service().read(TARGET, 'a.ts')).toMatchObject({
      kind: 'text',
      content: 'const a = 1;\n',
      truncated: false,
    });
    const big = await service().read(TARGET, 'besar.txt');
    expect(big.content).toHaveLength(MAX_TEXT_BYTES);
    expect(big.truncated).toBe(true);
    expect(await service().read(TARGET, 'data.bin')).toMatchObject({ kind: 'binary', content: '' });
  });

  it('gambar dikirim sebagai base64 dengan MIME dari ekstensi', async () => {
    await w('logo.png', Buffer.from([137, 80, 78, 71]));
    expect(await service().read(TARGET, 'logo.png')).toMatchObject({
      kind: 'image',
      mime: 'image/png',
      content: Buffer.from([137, 80, 78, 71]).toString('base64'),
    });
  });

  it('folder bukan berkas; tidak ada = path_not_found', async () => {
    await mkdir(nodePath.join(dir, 'd'));
    await expect(service().read(TARGET, 'd')).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(service().read(TARGET, 'hilang.txt')).rejects.toMatchObject({
      code: 'path_not_found',
    });
  });
});

describe('batas folder project', () => {
  it('menolak path absolut, .., NUL, dan .git', async () => {
    await w('a.txt', 'x');
    await w('.git/HEAD', 'ref');
    const cases = [
      '../luar.txt',
      'src/../../luar.txt',
      nodePath.join(outside, 'x.txt'),
      '/etc/passwd',
      'C:\\Windows\\win.ini',
      'a\0.txt',
      '.git/HEAD',
      'node_modules',
    ];
    for (const path of cases) {
      await expect(service().read(TARGET, path), path).rejects.toBeInstanceOf(PathError);
    }
    await expect(service().list(TARGET, '..')).rejects.toBeInstanceOf(PathError);
  });

  it('symlink yang menunjuk ke luar folder ditolak dan tidak tampil di daftar', async () => {
    await writeFile(nodePath.join(outside, 'rahasia.txt'), 'jangan');
    try {
      await symlink(outside, nodePath.join(dir, 'tautan'), 'junction');
    } catch {
      return; // Tanpa hak membuat symlink/junction, kasus ini tidak bisa diuji di mesin ini.
    }
    await expect(service().read(TARGET, 'tautan/rahasia.txt')).rejects.toMatchObject({
      code: 'path_not_allowed',
    });
    expect((await service().list(TARGET, '')).entries).toEqual([]);
  });
});

describe('files.find', () => {
  it('mencocokkan longgar dan mengurutkan nama berkas yang cocok lebih dulu', async () => {
    await w('src/components/Button.tsx', '');
    await w('src/utils/buttonHelpers.ts', '');
    await w('docs/notes.md', '');
    await w('node_modules/button/index.js', '');

    const { paths } = await service().find(TARGET, 'button');
    expect(paths).toEqual(['src/components/Button.tsx', 'src/utils/buttonHelpers.ts']);
    expect((await service().find(TARGET, 'stbn')).paths).toContain('src/components/Button.tsx');
    expect((await service().find(TARGET, 'zzzz')).paths).toEqual([]);
  });
});
