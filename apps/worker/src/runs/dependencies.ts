import { promises as fs } from 'node:fs';
import nodePath from 'node:path';
import { packageManagerOf, type PackageManager } from '../preview/devcommand.js';

/**
 * Perintah instal per manajer: dengan lockfile, persis sesuai lockfile; tanpa lockfile, tanpa membuat lockfile baru
 * (lockfile baru ikut ke diff tinjauan sebagai perubahan yang tidak diminta; teramati di bukti presisi).
 */
const INSTALL: Record<PackageManager, { locks: string[]; locked: string; unlocked: string }> = {
  pnpm: {
    locks: ['pnpm-lock.yaml'],
    locked: 'pnpm install --frozen-lockfile',
    unlocked: 'pnpm install --lockfile=false',
  },
  yarn: {
    locks: ['yarn.lock'],
    locked: 'yarn install --frozen-lockfile',
    unlocked: 'yarn install --no-lockfile',
  },
  bun: {
    locks: ['bun.lock', 'bun.lockb'],
    locked: 'bun install --frozen-lockfile',
    unlocked: 'bun install --no-save',
  },
  npm: {
    locks: ['package-lock.json', 'npm-shrinkwrap.json'],
    locked: 'npm ci',
    unlocked: 'npm install --no-package-lock',
  },
};

const exists = (file: string) =>
  fs.stat(file).then(
    () => true,
    () => false,
  );

/**
 * Catatan untuk agent bila worktree run punya package.json tetapi belum punya node_modules (tidak ikut git, dan
 * setup worktree bawaannya kosong). Tanpa dependensi, typecheck/tes gagal (`tsc: not found`) dan LSP TypeScript
 * tidak menemukan server, lalu agent berhenti tanpa verifikasi (docs/DESIGN_PRESISI_AGENT.md). Catatan ini mengarahkan
 * agent menjalankan perintah instal; perintahnya tetap lewat approval seperti perintah lain.
 */
export async function dependencyInstruction(cwd: string): Promise<string> {
  let pkg: unknown;
  try {
    pkg = JSON.parse(await fs.readFile(nodePath.join(cwd, 'package.json'), 'utf8'));
  } catch {
    return '';
  }
  if (pkg === null || typeof pkg !== 'object' || Array.isArray(pkg)) return '';
  if (await exists(nodePath.join(cwd, 'node_modules'))) return '';
  const manager = INSTALL[await packageManagerOf(cwd, pkg as Record<string, unknown>)];
  let locked = false;
  for (const lock of manager.locks) locked ||= await exists(nodePath.join(cwd, lock));
  const install = locked ? manager.locked : manager.unlocked;
  return [
    '',
    '',
    '# Dependensi worktree',
    `Worktree ini belum punya node_modules, jadi typecheck dan tes belum bisa jalan. "Dependensi belum terpasang" bukan alasan melewati verifikasi: sebelum menyatakan selesai, jalankan \`${install}\` dengan tool bash (izin pemilik diminta otomatis; jangan meminta lewat teks), lalu jalankan typecheck dan tes terkait. Hanya bila izin ditolak atau instal gagal, selesai tanpa verifikasi dan sebut itu di laporan.`,
  ].join('\n');
}
