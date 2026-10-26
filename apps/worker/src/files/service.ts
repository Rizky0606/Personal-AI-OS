import { promises as fs } from 'node:fs';
import nodePath from 'node:path';
import type { FileContent, FileList, PreviewTarget } from '@aios/contracts';
import { PathError, isInside } from '../paths/normalize.js';

/** Batas agar satu panggilan tidak membebani worker atau soket lokal. */
export const MAX_ENTRIES = 500;
export const MAX_TEXT_BYTES = 512 * 1024;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_FIND_FILES = 5_000;
const MAX_FIND_DEPTH = 8;
const MAX_MATCHES = 30;
/** Tidak pernah ditampilkan: metadata git dan dependensi. */
const HIDDEN = new Set(['.git', 'node_modules']);

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
};

export interface FilesDeps {
  /** Folder kerja untuk project atau worktree run (galat bila belum terikat atau worktree hilang). */
  resolve: (target: PreviewTarget) => Promise<{ cwd: string }>;
}

export interface FilesService {
  list(target: PreviewTarget, path: string): Promise<FileList>;
  read(target: PreviewTarget, path: string): Promise<FileContent>;
  find(target: PreviewTarget, query: string): Promise<{ paths: string[] }>;
}

const extensionOf = (name: string) => nodePath.extname(name).slice(1).toLowerCase();
const toPosix = (p: string) => p.split(nodePath.sep).join('/');

/**
 * Berkas worktree/folder project untuk tab Berkas (hanya baca). Setiap path relatif diselesaikan lewat
 * realpath dan harus tetap di dalam akar, jadi `..`, path absolut, dan symlink yang keluar ditolak.
 */
export function createFilesService({ resolve }: FilesDeps): FilesService {
  async function root(target: PreviewTarget): Promise<string> {
    const { cwd } = await resolve(target);
    return fs.realpath(cwd);
  }

  async function safe(base: string, relative: string): Promise<string> {
    if (relative.includes('\0'))
      throw new PathError('invalid_request', 'Path berisi karakter terlarang.');
    const normalized = relative.replaceAll('\\', '/');
    if (
      nodePath.isAbsolute(relative) ||
      normalized.startsWith('/') ||
      /^[A-Za-z]:/.test(normalized)
    ) {
      throw new PathError('path_not_allowed', 'Path harus relatif terhadap folder project.');
    }
    const parts = normalized.split('/').filter((p) => p !== '' && p !== '.');
    if (parts.includes('..'))
      throw new PathError('path_not_allowed', 'Path keluar dari folder project.');
    if (parts.some((p) => HIDDEN.has(p.toLowerCase()))) {
      throw new PathError('path_not_allowed', 'Folder ini disembunyikan.');
    }
    let real: string;
    try {
      real = await fs.realpath(nodePath.join(base, ...parts));
    } catch {
      throw new PathError('path_not_found', 'Berkas atau folder tidak ditemukan.');
    }
    if (!isInside(base, real)) {
      throw new PathError('path_not_allowed', 'Path keluar dari folder project.');
    }
    return real;
  }

  return {
    async list(target, path) {
      const base = await root(target);
      const dir = await safe(base, path);
      const stat = await fs.stat(dir);
      if (!stat.isDirectory()) throw new PathError('not_a_directory', 'Ini bukan folder.');
      const dirents = (await fs.readdir(dir, { withFileTypes: true }))
        .filter((d) => !HIDDEN.has(d.name.toLowerCase()) && !d.isSymbolicLink())
        .filter((d) => d.isDirectory() || d.isFile())
        .sort(
          (a, b) =>
            Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name),
        );
      const shown = dirents.slice(0, MAX_ENTRIES);
      const rel = toPosix(nodePath.relative(base, dir));
      const entries = await Promise.all(
        shown.map(async (d) => ({
          name: d.name,
          path: rel === '' ? d.name : `${rel}/${d.name}`,
          kind: d.isDirectory() ? ('dir' as const) : ('file' as const),
          size: d.isFile() ? (await fs.stat(nodePath.join(dir, d.name))).size : 0,
        })),
      );
      return { path: rel, entries, truncated: dirents.length > MAX_ENTRIES };
    },

    async read(target, path) {
      const base = await root(target);
      const file = await safe(base, path);
      const stat = await fs.stat(file);
      if (!stat.isFile()) throw new PathError('invalid_request', 'Ini bukan berkas.');
      const rel = toPosix(nodePath.relative(base, file));
      const image = IMAGE_MIME[extensionOf(file)];
      if (image) {
        if (stat.size > MAX_IMAGE_BYTES) {
          return {
            path: rel,
            size: stat.size,
            kind: 'too_large',
            mime: image,
            content: '',
            truncated: false,
          };
        }
        const bytes = await fs.readFile(file);
        return {
          path: rel,
          size: stat.size,
          kind: 'image',
          mime: image,
          content: bytes.toString('base64'),
          truncated: false,
        };
      }
      const handle = await fs.open(file, 'r');
      try {
        const buffer = Buffer.alloc(Math.min(stat.size, MAX_TEXT_BYTES));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        const head = buffer.subarray(0, bytesRead);
        if (head.subarray(0, 8000).includes(0)) {
          return {
            path: rel,
            size: stat.size,
            kind: 'binary',
            mime: 'application/octet-stream',
            content: '',
            truncated: false,
          };
        }
        return {
          path: rel,
          size: stat.size,
          kind: 'text',
          mime: 'text/plain',
          content: head.toString('utf8'),
          truncated: stat.size > MAX_TEXT_BYTES,
        };
      } finally {
        await handle.close();
      }
    },

    async find(target, query) {
      const base = await root(target);
      const needle = query.toLowerCase();
      const found: string[] = [];
      const queue: { dir: string; depth: number }[] = [{ dir: base, depth: 0 }];
      let seen = 0;
      while (queue.length > 0 && seen < MAX_FIND_FILES) {
        const { dir, depth } = queue.shift()!;
        const dirents = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
        for (const d of dirents) {
          if (HIDDEN.has(d.name.toLowerCase()) || d.isSymbolicLink()) continue;
          const full = nodePath.join(dir, d.name);
          if (d.isDirectory()) {
            if (depth < MAX_FIND_DEPTH) queue.push({ dir: full, depth: depth + 1 });
          } else if (d.isFile()) {
            seen++;
            const rel = toPosix(nodePath.relative(base, full));
            if (isSubsequence(needle, rel.toLowerCase())) found.push(rel);
          }
        }
      }
      const rank = (p: string) => {
        const lower = p.toLowerCase();
        const name = lower.slice(lower.lastIndexOf('/') + 1);
        return (
          (name.startsWith(needle)
            ? 0
            : name.includes(needle)
              ? 1
              : lower.includes(needle)
                ? 2
                : 3) *
            1000 +
          p.length
        );
      };
      return { paths: found.sort((a, b) => rank(a) - rank(b)).slice(0, MAX_MATCHES) };
    },
  };
}

/** Semua huruf `needle` muncul berurutan di `text` (pencocokan longgar ala quick-open). */
function isSubsequence(needle: string, text: string): boolean {
  let i = 0;
  for (const ch of text) {
    if (ch === needle[i]) i++;
    if (i === needle.length) return true;
  }
  return needle.length === 0;
}
