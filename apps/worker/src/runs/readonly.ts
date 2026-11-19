import { promises as fs } from 'node:fs';
import nodePath from 'node:path';

/**
 * Perintah baca saja yang diizinkan worker tanpa bertanya (SECURITY_OPS.md, "Perintah baca saja"). Daftar sengaja
 * sempit dan ditulis per perintah; yang tidak cocok persis tetap ditanyakan ke pemilik:
 * - `git status|diff|log|show` tanpa opsi global (`-c`, `-C`, `--git-dir`, ...) dan tanpa opsi yang menulis,
 *   menjalankan program, atau membaca berkas di luar argumen (`--output`, `--ext-diff`, `--textconv`, `-O<berkas>`),
 *   juga tanpa pathspec ajaib (`:/` = seluruh repo). Alias git tidak bisa menimpa perintah bawaan.
 * - `ls` tanpa mengikuti symlink (`-L`, `--dereference`), `pwd`, `command -v <nama>`.
 * - `cat <berkas>` dan `head [-n N] <berkas>`.
 * Semua argumen path harus berada di dalam folder kerja run setelah symlink diselesaikan, cwd perintah juga.
 * Karakter shell (`;|&<>$\`()` dst., kutip, glob, `~`, baris baru) membuat perintah ditanyakan: tanpa itu kalimat
 * perintah = satu program dengan argumen literal.
 */
const SHELL_META = /[;&|<>$`(){}[\]*?~!#'"\\\n\r\t]/;
const GIT_READ = ['status', 'diff', 'log', 'show'];
const GIT_UNSAFE = /^(?:--output(?:=|$)|--ext-diff$|--textconv$|-o$|-O|:)/;

export async function isReadOnlyCommand(
  command: string,
  cwd: string | undefined,
  root: string,
): Promise<boolean> {
  if (!cwd || SHELL_META.test(command)) return false;
  const words = command.trim().split(/ +/);
  const [program, ...args] = words;
  // `=` hanya boleh di opsi git berbentuk --nama=nilai (mis. --format=%h), tidak di nama program atau path.
  if (words.some((w) => w.includes('=') && (program !== 'git' || !/^--[a-z-]+=/.test(w)))) {
    return false;
  }
  if ((await relativeInside(root, cwd)) === undefined) return false;
  const paths = (list: string[], mustExist = false) => everyInside(root, cwd, list, mustExist);
  switch (program) {
    case 'git': {
      const [sub, ...rest] = args;
      if (!sub || !GIT_READ.includes(sub)) return false;
      if (rest.some((a) => GIT_UNSAFE.test(a))) return false;
      // Revisi dan pathspec dinilai sebagai path: `..`/absolut yang keluar folder run membuatnya ditanyakan.
      return paths(rest.filter((a) => !a.startsWith('-')));
    }
    case 'ls':
      // `-L` mengikuti symlink folder keluar dari folder run dan mendaftar isinya.
      if (args.some((a) => /^-[^-]*L/.test(a) || a === '--dereference')) return false;
      return paths(args.filter((a) => !a.startsWith('-')));
    case 'pwd':
      return args.length === 0;
    case 'command':
      return args.length === 2 && args[0] === '-v' && /^[A-Za-z0-9._+-]+$/.test(args[1] ?? '');
    case 'cat':
      return args.length > 0 && args.every((a) => !a.startsWith('-')) && paths(args, true);
    case 'head': {
      const files: string[] = [];
      for (let i = 0; i < args.length; i++) {
        const a = args[i] ?? '';
        if (a === '-n' && /^\d+$/.test(args[i + 1] ?? '')) i++;
        else if (/^-n?\d+$/.test(a)) continue;
        else if (a.startsWith('-')) return false;
        else files.push(a);
      }
      return files.length > 0 && paths(files, true);
    }
    default:
      return false;
  }
}

async function everyInside(
  root: string,
  cwd: string,
  list: string[],
  mustExist = false,
): Promise<boolean> {
  for (const item of list) {
    if ((await relativeInside(root, nodePath.resolve(cwd, item), mustExist)) === undefined) {
      return false;
    }
  }
  return true;
}

/**
 * Path (setelah symlink) di dalam root: path relatif terhadap root yang sebenarnya (`''` = root itu sendiri), atau
 * undefined bila di luar. Path yang belum ada dinilai dari induk terdekat yang ada, kecuali `mustExist` (berkas yang
 * dibaca harus ada, supaya symlink di dalamnya ikut diperiksa).
 */
export async function relativeInside(
  root: string,
  target: string,
  mustExist = false,
): Promise<string | undefined> {
  const realRoot = await fs.realpath(root).catch(() => undefined);
  if (!realRoot) return undefined;
  let probe = nodePath.resolve(target);
  let suffix = '';
  for (;;) {
    const real = await fs.realpath(probe).catch(() => undefined);
    if (real !== undefined) {
      const rel = nodePath.relative(realRoot, nodePath.join(real, suffix));
      return rel === '' || (!rel.startsWith('..') && !nodePath.isAbsolute(rel)) ? rel : undefined;
    }
    if (mustExist) return undefined;
    const parent = nodePath.dirname(probe);
    if (parent === probe) return undefined;
    suffix = nodePath.join(nodePath.basename(probe), suffix);
    probe = parent;
  }
}
