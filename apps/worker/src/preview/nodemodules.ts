import { promises as fs } from 'node:fs';
import nodePath from 'node:path';
import type { ProcessManager } from '../process/manager.js';

/**
 * Worktree tidak punya node_modules (tidak ikut git). Bila folder project punya dan git mengabaikannya,
 * ditautkan sebagai junction supaya dev server bisa jalan tanpa menginstal ulang. Hanya tautan di dalam
 * worktree; folder asli tidak diubah.
 */
export async function linkNodeModules(
  processes: ProcessManager,
  projectPath: string,
  cwd: string,
): Promise<void> {
  if (nodePath.resolve(projectPath) === nodePath.resolve(cwd)) return;
  const link = nodePath.join(cwd, 'node_modules');
  const source = nodePath.join(projectPath, 'node_modules');
  const has = (p: string) =>
    fs.stat(p).then(
      () => true,
      () => false,
    );
  if ((await has(link)) || !(await has(source))) return;
  // Bila git tidak mengabaikan node_modules, tautan akan ikut ke diff review; jangan buat.
  const ignored = await processes.run('git', ['check-ignore', '-q', 'node_modules/'], {
    cwd,
    timeoutMs: 10_000,
  });
  if (ignored.code !== 0) return;
  await fs.symlink(source, link, 'junction');
  // Pola berakhiran "/" di .gitignore cuma cocok dengan direktori sungguhan, bukan symlink (perilaku
  // baku git) -- tautan yang baru dibuat tetap muncul sebagai "??" di git status walau node_modules/
  // sudah diabaikan proyek. Tambahkan pengecualian khusus symlink (tanpa "/") di exclude lokal milik
  // repo (tidak ikut commit) supaya status tetap bersih untuk diff review.
  await excludeSymlinkFromStatus(processes, cwd);
}

async function excludeSymlinkFromStatus(processes: ProcessManager, cwd: string): Promise<void> {
  const common = await processes.run('git', ['rev-parse', '--git-common-dir'], {
    cwd,
    timeoutMs: 10_000,
  });
  if (common.code !== 0) return;
  const excludeFile = nodePath.resolve(cwd, common.stdout.trim(), 'info', 'exclude');
  await fs.mkdir(nodePath.dirname(excludeFile), { recursive: true }).catch(() => undefined);
  const current = await fs.readFile(excludeFile, 'utf8').catch(() => '');
  if (current.split('\n').some((line) => line.trim() === 'node_modules')) return;
  const prefix = current === '' || current.endsWith('\n') ? '' : '\n';
  await fs.appendFile(excludeFile, `${prefix}node_modules\n`).catch(() => undefined);
}

/**
 * Melepas tautan node_modules (junction/symlink) di folder itu tanpa menyentuh isi tujuannya. Wajib dipanggil sebelum
 * worktree dihapus: menghapus rekursif lewat tautan bisa mengosongkan node_modules milik project asli.
 */
export async function unlinkNodeModules(dir: string): Promise<void> {
  const link = nodePath.join(dir, 'node_modules');
  const stat = await fs.lstat(link).catch(() => undefined);
  if (!stat?.isSymbolicLink()) return;
  // Junction di Windows dilepas dengan rmdir; symlink POSIX dengan unlink.
  await fs.rmdir(link).catch(() => fs.unlink(link));
}
