import { promises as fs } from 'node:fs';
import nodePath from 'node:path';

export type PackageManager = 'pnpm' | 'yarn' | 'bun' | 'npm';

export interface DevCommand {
  /** Program yang dijalankan (tanpa shell); di Windows pembungkus `.cmd` dijalankan lewat `cmd.exe`. */
  command: string;
  args: string[];
  /** Untuk ditampilkan, mis. `pnpm run dev`. */
  label: string;
  manager: PackageManager;
  script: string;
}

/** Skrip yang dicoba berurutan; yang pertama ada dipakai. */
const SCRIPTS = ['dev', 'start', 'serve', 'preview'];
const SAFE_SCRIPT = /^[A-Za-z0-9:_.-]{1,64}$/;

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function packageManagerOf(
  dir: string,
  pkg: Record<string, unknown>,
): Promise<PackageManager> {
  const declared = typeof pkg.packageManager === 'string' ? pkg.packageManager.split('@')[0] : '';
  if (declared === 'pnpm' || declared === 'yarn' || declared === 'bun' || declared === 'npm') {
    return declared;
  }
  if (await exists(nodePath.join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (await exists(nodePath.join(dir, 'yarn.lock'))) return 'yarn';
  if (
    (await exists(nodePath.join(dir, 'bun.lockb'))) ||
    (await exists(nodePath.join(dir, 'bun.lock')))
  ) {
    return 'bun';
  }
  return 'npm';
}

/**
 * Perintah dev server dari `package.json` di folder itu: skrip `dev`, lalu `start`, `serve`, `preview`.
 * Nama skrip divalidasi ketat karena menjadi argumen proses. Undefined bila tidak ada skrip yang cocok.
 */
export async function detectDevCommand(dir: string): Promise<DevCommand | undefined> {
  let pkg: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(
      await fs.readFile(nodePath.join(dir, 'package.json'), 'utf8'),
    );
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    pkg = parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const scripts =
    pkg.scripts !== null && typeof pkg.scripts === 'object'
      ? (pkg.scripts as Record<string, unknown>)
      : {};
  const script = SCRIPTS.find(
    (name) => typeof scripts[name] === 'string' && SAFE_SCRIPT.test(name),
  );
  if (!script) return undefined;

  const manager = await packageManagerOf(dir, pkg);
  const label = `${manager} run ${script}`;
  const win = process.platform === 'win32';
  // Di Windows pnpm/yarn/npm adalah berkas .cmd yang tidak bisa dijalankan langsung tanpa shell:
  // cmd.exe dipanggil dengan token tetap (manajer dan nama skrip sudah divalidasi).
  return win
    ? { command: 'cmd.exe', args: ['/d', '/c', manager, 'run', script], label, manager, script }
    : { command: manager, args: ['run', script], label, manager, script };
}
