import { promises as fs } from 'node:fs';
import nodePath, { type PlatformPath } from 'node:path';
import type { LocalErrorCode } from '@aios/contracts';

/** Galat path dengan kode yang dipetakan UI; pesan aman ditampilkan ke pengguna. */
export class PathError extends Error {
  constructor(
    readonly code: Extract<
      LocalErrorCode,
      | 'invalid_request'
      | 'path_not_allowed'
      | 'path_not_found'
      | 'not_a_directory'
      | 'path_too_broad'
    >,
    message: string,
  ) {
    super(message);
    this.name = 'PathError';
  }
}

const MAX_PATH_CHARS = 4096;

/**
 * Menolak bentuk path yang tidak boleh dipercaya sebelum menyentuh filesystem: kosong, byte NUL, terlalu
 * panjang, relatif, awalan perangkat/namespace Windows (`\\?\`, `\\.\`), dan UNC (berbagi jaringan).
 * `api` bisa diganti (path.win32 / path.posix) supaya aturan Windows teruji di platform mana pun.
 */
export function assertSafePathString(input: string, api: PlatformPath = nodePath): void {
  if (input.trim() === '') throw new PathError('invalid_request', 'Path kosong.');
  if (input.includes('\0'))
    throw new PathError('invalid_request', 'Path berisi karakter terlarang.');
  if (input.length > MAX_PATH_CHARS)
    throw new PathError('invalid_request', 'Path terlalu panjang.');

  if (api === nodePath.win32 || api.sep === '\\') {
    const slashed = input.replaceAll('/', '\\');
    if (slashed.startsWith('\\\\')) {
      throw new PathError(
        'path_not_allowed',
        'Path UNC, perangkat, atau namespace Windows tidak diizinkan.',
      );
    }
    // "C:foo" (relatif terhadap direktori aktif drive C) bukan path absolut.
    if (/^[A-Za-z]:(?![\\/])/.test(input)) {
      throw new PathError('invalid_request', 'Path harus absolut, misalnya C:\\Proyek\\app.');
    }
  }
  if (!api.isAbsolute(input)) throw new PathError('invalid_request', 'Path harus absolut.');
}

/** Windows membandingkan path tanpa membedakan huruf besar/kecil. */
export function isInside(root: string, candidate: string, api: PlatformPath = nodePath): boolean {
  const rel = api.relative(root, candidate);
  if (rel === '') return true;
  // Di drive berbeda, relative() mengembalikan path absolut.
  return !rel.startsWith('..') && !api.isAbsolute(rel);
}

/**
 * Path kanonik: absolut, tanpa `.`/`..`, symlink dan junction diselesaikan (realpath). Bagian akhir yang belum
 * ada (mis. worktree yang akan dibuat) diselesaikan lewat leluhur terdekat yang ada, jadi `allowed\link\baru`
 * yang menembus keluar lewat symlink tetap ketahuan.
 */
export async function canonicalize(input: string): Promise<string> {
  assertSafePathString(input);
  const absolute = nodePath.resolve(input);
  const pending: string[] = [];
  let probe = absolute;
  for (;;) {
    try {
      const real = await fs.realpath(probe);
      return pending.length === 0 ? real : nodePath.join(real, ...pending.reverse());
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') {
        throw new PathError('path_not_found', 'Folder tidak bisa dibaca.');
      }
      const parent = nodePath.dirname(probe);
      if (parent === probe) throw new PathError('path_not_found', 'Folder tidak ditemukan.');
      pending.push(nodePath.basename(probe));
      probe = parent;
    }
  }
}

export async function assertDirectory(path: string): Promise<void> {
  let stat;
  try {
    stat = await fs.stat(path);
  } catch {
    throw new PathError('path_not_found', 'Folder tidak ditemukan.');
  }
  if (!stat.isDirectory()) throw new PathError('not_a_directory', 'Path ini bukan folder.');
}
