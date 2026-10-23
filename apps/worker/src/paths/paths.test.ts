import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AllowList } from './allowlist.js';
import { PathError, assertSafePathString, canonicalize, isInside } from './normalize.js';

describe('assertSafePathString (aturan Windows, teruji di platform mana pun)', () => {
  const win = path.win32;

  it.each([
    ['', 'kosong'],
    ['   ', 'spasi saja'],
    ['C:\\proyek\0evil', 'byte NUL'],
    ['proyek\\app', 'relatif'],
    ['..\\proyek', 'relatif dengan ..'],
    ['C:proyek', 'relatif terhadap direktori aktif drive'],
    ['\\\\server\\share\\proyek', 'UNC'],
    ['//server/share/proyek', 'UNC dengan slash'],
    ['\\\\?\\C:\\proyek', 'namespace Win32 file'],
    ['\\\\.\\PhysicalDrive0', 'perangkat'],
    ['//?/C:/proyek', 'namespace dengan slash'],
  ])('menolak %j (%s)', (input) => {
    expect(() => assertSafePathString(input, win)).toThrow(PathError);
  });

  it('menolak path terlalu panjang', () => {
    expect(() => assertSafePathString(`C:\\${'a'.repeat(5000)}`, win)).toThrow(/terlalu panjang/);
  });

  it.each(['C:\\Proyek\\app', 'D:/kerja/app', 'c:\\proyek'])('menerima %j', (input) => {
    expect(() => assertSafePathString(input, win)).not.toThrow();
  });

  it('POSIX: relatif ditolak, absolut diterima', () => {
    expect(() => assertSafePathString('proyek', path.posix)).toThrow(PathError);
    expect(() => assertSafePathString('/home/aku/proyek', path.posix)).not.toThrow();
  });
});

describe('isInside', () => {
  it('termasuk akar itu sendiri dan turunannya; saudara dengan awalan sama bukan turunan', () => {
    const win = path.win32;
    expect(isInside('C:\\Proyek', 'C:\\Proyek', win)).toBe(true);
    expect(isInside('C:\\Proyek', 'C:\\Proyek\\src\\a.ts', win)).toBe(true);
    expect(isInside('C:\\Proyek', 'C:\\ProyekLain', win)).toBe(false);
    expect(isInside('C:\\Proyek', 'C:\\Proyek\\..\\Rahasia', win)).toBe(false);
  });

  it('Windows tidak membedakan huruf besar/kecil dan drive berbeda bukan turunan', () => {
    const win = path.win32;
    expect(isInside('C:\\Proyek', 'c:\\proyek\\SRC', win)).toBe(true);
    expect(isInside('C:\\Proyek', 'D:\\Proyek', win)).toBe(false);
  });

  it('POSIX membedakan huruf besar/kecil', () => {
    expect(isInside('/a/Proyek', '/a/proyek/x', path.posix)).toBe(false);
  });
});

describe('AllowList pada filesystem sungguhan', () => {
  let base: string;
  let allowed: string;
  let outside: string;
  let list: AllowList;

  beforeEach(async () => {
    base = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'aios-worker-')));
    allowed = path.join(base, 'allowed');
    outside = path.join(base, 'outside');
    await fs.mkdir(path.join(allowed, 'proyek', 'src'), { recursive: true });
    await fs.mkdir(outside, { recursive: true });
    await fs.writeFile(path.join(outside, 'rahasia.txt'), 'rahasia');
    list = new AllowList({ file: path.join(base, 'data', 'allowed.json'), forbidden: [] });
    await list.load();
    await list.add(allowed);
  });
  afterEach(async () => {
    await fs.rm(base, { recursive: true, force: true });
  });

  it('mengizinkan folder izin, turunannya, dan path yang belum ada di dalamnya', async () => {
    expect(await list.resolve(allowed)).toBe(allowed);
    expect(await list.resolve(path.join(allowed, 'proyek', 'src'))).toBe(
      path.join(allowed, 'proyek', 'src'),
    );
    expect(await list.resolve(path.join(allowed, 'proyek', 'worktree-baru'))).toBe(
      path.join(allowed, 'proyek', 'worktree-baru'),
    );
  });

  it('menolak folder di luar daftar dengan kode path_not_allowed', async () => {
    await expect(list.resolve(outside)).rejects.toMatchObject({ code: 'path_not_allowed' });
    await expect(list.resolve(base)).rejects.toMatchObject({ code: 'path_not_allowed' });
  });

  it('menolak ../ yang keluar dari folder izin', async () => {
    const sneaky = `${path.join(allowed, 'proyek')}${path.sep}..${path.sep}..${path.sep}outside`;
    await expect(list.resolve(sneaky)).rejects.toMatchObject({ code: 'path_not_allowed' });
    await expect(
      list.resolve(path.join(allowed, '..', 'outside', 'rahasia.txt')),
    ).rejects.toMatchObject({
      code: 'path_not_allowed',
    });
  });

  it('../ yang tetap di dalam folder izin diterima setelah dinormalisasi', async () => {
    const inside = path.join(allowed, 'proyek', 'src', '..', 'src');
    expect(await list.resolve(inside)).toBe(path.join(allowed, 'proyek', 'src'));
  });

  it('menolak symlink/junction di dalam folder izin yang menunjuk ke luar', async () => {
    const link = path.join(allowed, 'proyek', 'tautan');
    await fs.symlink(outside, link, 'junction');

    await expect(list.resolve(link)).rejects.toMatchObject({ code: 'path_not_allowed' });
    await expect(list.resolve(path.join(link, 'rahasia.txt'))).rejects.toMatchObject({
      code: 'path_not_allowed',
    });
    // Juga untuk path baru di balik tautan (calon tulis ke luar folder).
    await expect(list.resolve(path.join(link, 'baru.txt'))).rejects.toMatchObject({
      code: 'path_not_allowed',
    });
  });

  it('symlink yang menunjuk ke dalam folder izin diterima dan dikembalikan sebagai path nyata', async () => {
    const link = path.join(allowed, 'alias');
    await fs.symlink(path.join(allowed, 'proyek'), link, 'junction');

    expect(await list.resolve(link)).toBe(path.join(allowed, 'proyek'));
  });

  it('akar yang diganti junction ke luar setelah ditambahkan tidak membuka akses ke luar', async () => {
    const root = path.join(base, 'akar');
    await fs.mkdir(root);
    await list.add(root);
    await fs.rmdir(root);
    await fs.symlink(outside, root, 'junction');

    await expect(list.resolve(path.join(root, 'rahasia.txt'))).rejects.toMatchObject({
      code: 'path_not_allowed',
    });
  });

  it('menolak path relatif, kosong, dan yang bukan folder saat menambah', async () => {
    await expect(list.add('relatif')).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(list.add('')).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(list.add(path.join(outside, 'rahasia.txt'))).rejects.toMatchObject({
      code: 'not_a_directory',
    });
    await expect(list.add(path.join(base, 'tidak-ada'))).rejects.toBeInstanceOf(PathError);
  });

  it('menolak root drive dan folder home beserta leluhurnya', async () => {
    const strict = new AllowList({
      file: path.join(base, 'strict.json'),
      forbidden: [path.join(base, 'home', 'aku')],
    });
    await fs.mkdir(path.join(base, 'home', 'aku', 'kerja'), { recursive: true });

    await expect(strict.add(path.parse(base).root)).rejects.toMatchObject({
      code: 'path_too_broad',
    });
    await expect(strict.add(path.join(base, 'home'))).rejects.toMatchObject({
      code: 'path_too_broad',
    });
    await expect(strict.add(path.join(base, 'home', 'aku'))).rejects.toMatchObject({
      code: 'path_too_broad',
    });
    await expect(strict.add(path.join(base, 'home', 'aku', 'kerja'))).resolves.toBeTypeOf('string');
  });

  it('daftar bertahan di disk, tidak ganda, dan folder bisa dicabut', async () => {
    await list.add(allowed);
    await list.add(path.join(allowed, '..', 'allowed'));
    expect(list.list()).toEqual([allowed]);

    const reloaded = new AllowList({
      file: path.join(base, 'data', 'allowed.json'),
      forbidden: [],
    });
    await reloaded.load();
    expect(reloaded.list()).toEqual([allowed]);

    await reloaded.remove(allowed);
    await expect(reloaded.resolve(allowed)).rejects.toMatchObject({ code: 'path_not_allowed' });
    const again = new AllowList({ file: path.join(base, 'data', 'allowed.json'), forbidden: [] });
    await again.load();
    expect(again.list()).toEqual([]);
  });

  it('berkas daftar rusak: mulai kosong (tertutup) dan disimpan sebagai .bad', async () => {
    const file = path.join(base, 'rusak.json');
    await fs.writeFile(file, '{bukan json');
    const broken = new AllowList({ file, forbidden: [] });

    await broken.load();

    expect(broken.list()).toEqual([]);
    await expect(fs.stat(`${file}.bad`)).resolves.toBeDefined();
  });

  it('canonicalize menolak NUL dan path relatif sebelum menyentuh disk', async () => {
    await expect(canonicalize(`${allowed}\0x`)).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(canonicalize('.')).rejects.toMatchObject({ code: 'invalid_request' });
  });
});
