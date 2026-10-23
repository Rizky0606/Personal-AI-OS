// Mengompilasi worker menjadi satu .exe dengan Bun untuk dipakai Tauri sebagai sidecar (externalBin).
// Tauri mewajibkan akhiran target triple pada nama berkas.
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outfile = resolve(
  root,
  '../desktop/src-tauri/binaries/aios-worker-x86_64-pc-windows-msvc.exe',
);
mkdirSync(dirname(outfile), { recursive: true });

const result = spawnSync(
  'bun',
  [
    'build',
    'src/main.ts',
    '--compile',
    '--minify',
    '--target=bun-windows-x64',
    // Dimuat malas oleh playwright-core hanya untuk Firefox/WebDriver BiDi; kita hanya memakai Chromium (CDP).
    '--external',
    'chromium-bidi/*',
    '--external',
    'electron',
    '--outfile',
    outfile,
  ],
  { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' },
);
if (result.error) {
  console.error('Bun tidak ditemukan. Pasang dari https://bun.sh lalu ulangi.');
  process.exit(1);
}
process.exit(result.status ?? 1);
