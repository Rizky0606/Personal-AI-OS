#!/usr/bin/env node
// Menyiapkan rilis: menaikkan versi di semua tempat, commit, lalu membuat tag vX.Y.Z.
//   node infra/scripts/release.mjs 1.0.1           # commit + tag (lokal)
//   node infra/scripts/release.mjs 1.0.1 --push    # sekaligus push commit dan tag (memicu build rilis di CI)
//   node infra/scripts/release.mjs 1.0.1 --dry-run # hanya menampilkan perubahan
// Tag v* memicu build-desktop.yml (installer + latest.json untuk auto-update) dan build-android.yml
// (APK bertanda tangan). Versi baru harus lebih tinggi dari rilis sebelumnya agar terpasang menimpa.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const version = args.find((a) => !a.startsWith('--'));
const push = args.includes('--push');
const dryRun = args.includes('--dry-run');

const fail = (message) => {
  console.error(`GAGAL: ${message}`);
  process.exit(1);
};
const git = (...gitArgs) => execFileSync('git', gitArgs, { cwd: root, encoding: 'utf8' }).trim();

if (!version || !/^\d+\.\d+\.\d+$/.test(version))
  fail('pakai: release.mjs X.Y.Z [--push] [--dry-run]');

const parse = (v) => v.split('.').map(Number);
const newer = (a, b) => {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};

const tauriPath = resolve(root, 'apps/desktop/src-tauri/tauri.conf.json');
const tauri = JSON.parse(readFileSync(tauriPath, 'utf8'));
const current = tauri.version;
const tag = `v${version}`;
if (git('tag', '--list', tag)) fail(`tag ${tag} sudah ada`);
const lastTag = git('tag', '--list', 'v*', '--sort=-v:refname').split('\n')[0] || '';
if (lastTag && !newer(version, lastTag.slice(1)))
  fail(`${version} harus lebih tinggi dari ${lastTag}`);
if (!dryRun && git('status', '--porcelain'))
  fail('working tree belum bersih; commit atau stash dulu');

/** Mengganti satu kemunculan; gagal keras bila pola tidak ditemukan (berkas berubah bentuk). */
function replaceIn(path, pattern, replacement) {
  const file = resolve(root, path);
  const text = readFileSync(file, 'utf8');
  if (!pattern.test(text)) fail(`pola versi tidak ditemukan di ${path}`);
  const next = text.replace(pattern, replacement);
  if (dryRun) console.log(`${path}: ${text.match(pattern)[0].trim()} -> ${replacement.trim()}`);
  else writeFileSync(file, next);
}

replaceIn(
  'apps/desktop/src-tauri/tauri.conf.json',
  /"version": "[^"]+"/,
  `"version": "${version}"`,
);
replaceIn('apps/desktop/src-tauri/Cargo.toml', /^version = "[^"]+"/m, `version = "${version}"`);
replaceIn(
  'apps/android/app/build.gradle.kts',
  /getOrElse\("\d+\.\d+\.\d+"\)/,
  `getOrElse("${version}")`,
);
const today = new Date().toISOString().slice(0, 10);
const changelog = readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8');
if (/^## \[[^\]]+\] - belum dirilis/m.test(changelog)) {
  replaceIn('CHANGELOG.md', /^## \[[^\]]+\] - belum dirilis/m, `## [${version}] - ${today}`);
} else {
  replaceIn(
    'CHANGELOG.md',
    /^(## \[)/m,
    `## [${version}] - ${today}\n\n- Lihat riwayat commit sejak ${lastTag || current}.\n\n$1`,
  );
}

if (dryRun) {
  console.log(`(dry-run) akan commit "chore(release): ${tag}" dan membuat tag ${tag}`);
  process.exit(0);
}

git(
  'add',
  'apps/desktop/src-tauri/tauri.conf.json',
  'apps/desktop/src-tauri/Cargo.toml',
  'apps/android/app/build.gradle.kts',
  'CHANGELOG.md',
);
git('commit', '-m', `chore(release): ${tag}`);
git('tag', '-a', tag, '-m', `Rilis ${tag}`);
console.log(`OK: ${current} -> ${version}, tag ${tag} dibuat.`);
if (push) {
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  git('push', 'origin', branch);
  git('push', 'origin', tag);
  console.log(`Didorong: ${branch} dan ${tag}. Build rilis berjalan di GitHub Actions.`);
} else {
  console.log(`Belum didorong. Jalankan: git push origin HEAD && git push origin ${tag}`);
}
