#!/usr/bin/env node
// Menyusun latest.json untuk updater Tauri dari installer NSIS dan berkas .sig hasil `tauri build`.
//   node infra/scripts/make-latest-json.mjs --version 1.0.0 --repo pemilik/repo --dir <folder nsis> --out latest.json
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Nama aset seperti yang disimpan GitHub Releases: karakter selain huruf, angka, `.`, `_`, `-`, dan `+` (termasuk
 * spasi) diganti titik. "Personal AI OS_1.0.4_x64-setup.exe" menjadi "Personal.AI.OS_1.0.4_x64-setup.exe".
 */
export const githubAssetName = (name) => name.replace(/[^A-Za-z0-9._+-]/g, '.');

export function buildLatest({ version, repo, installer, signature, notes = '', now = new Date() }) {
  if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) throw new Error(`versi tidak valid: ${version}`);
  if (!signature.trim()) throw new Error('tanda tangan kosong');
  return {
    version,
    notes,
    pub_date: now.toISOString(),
    platforms: {
      'windows-x86_64': {
        signature: signature.trim(),
        // Nama aset versi GitHub, bukan nama berkas lokal: tanpa ini URL berisi %20 dan updater mendapat 404.
        url: `https://github.com/${repo}/releases/download/v${version}/${encodeURIComponent(githubAssetName(installer))}`,
      },
    },
  };
}

function main() {
  const args = Object.fromEntries(
    process.argv
      .slice(2)
      .reduce(
        (pairs, arg, i, all) =>
          arg.startsWith('--') ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs,
        [],
      ),
  );
  for (const key of ['version', 'repo', 'dir', 'out'])
    if (!args[key]) throw new Error(`--${key} wajib`);
  const files = readdirSync(args.dir);
  const installer = files.find((f) => f.endsWith('-setup.exe'));
  if (!installer) throw new Error(`installer *-setup.exe tidak ada di ${args.dir}`);
  const signature = readFileSync(path.join(args.dir, `${installer}.sig`), 'utf8');
  writeFileSync(
    args.out,
    JSON.stringify(
      buildLatest({ version: args.version, repo: args.repo, installer, signature }),
      null,
      2,
    ) + '\n',
  );
}

if (process.argv[1]?.endsWith('make-latest-json.mjs')) main();
