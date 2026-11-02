import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { comparePixels } from './in-page.js';

/**
 * `pnpm shots:compare <folderA> <folderB>`: persentase piksel berbeda per layar (beda > 24 pada kanal
 * mana pun) lewat canvas getImageData di Playwright. Label cap build (pojok kanan bawah) tidak dihitung
 * karena isinya selalu berubah. Menulis tabel markdown ke stdout dan gambar A | B | selisih per layar ke
 * <induk folderB>/_compare/<A>__<B>/. Argumen ketiga (opsional) mengubah ambang kanal.
 */
const [argA, argB, argThreshold] = process.argv.slice(2);
if (!argA || !argB) {
  console.error('Pemakaian: pnpm shots:compare <folderA> <folderB> [ambang-kanal=24]');
  process.exit(2);
}
// pnpm --filter menjalankan skrip dari e2e/; path relatif dihitung dari folder tempat perintah diketik.
const cwd = process.env.INIT_CWD ?? process.cwd();
const dirA = path.resolve(cwd, argA);
const dirB = path.resolve(cwd, argB);
// Ambang bawaan 24 mengabaikan beda tonal halus (mis. kanvas vs pulau); turunkan untuk mengukurnya.
const CHANNEL_THRESHOLD = argThreshold === undefined ? 24 : Number(argThreshold);
if (!Number.isInteger(CHANNEL_THRESHOLD) || CHANNEL_THRESHOLD < 0 || CHANNEL_THRESHOLD > 255) {
  console.error('Ambang kanal harus bilangan bulat 0-255.');
  process.exit(2);
}
const STAMP_MASK = { width: 280, height: 32 };

const pngs = (dir: string) => new Set(readdirSync(dir).filter((f) => f.endsWith('.png')));
const a = pngs(dirA);
const b = pngs(dirB);
const names = [...new Set([...a, ...b])].sort();
const outDir = path.join(
  path.dirname(dirB),
  '_compare',
  `${path.basename(dirA)}__${path.basename(dirB)}`,
);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: process.env.E2E_BROWSER ?? 'msedge' });
try {
  const page = await browser.newPage();
  await page.goto('about:blank');
  const rows: string[] = [];
  for (const name of names) {
    const layar = name.replace(/\.png$/, '');
    if (!a.has(name) || !b.has(name)) {
      rows.push(`| ${layar} | ${a.has(name) ? 'hanya di A' : 'hanya di B'} |`);
      continue;
    }
    const result = await page.evaluate(comparePixels, {
      imgA: readFileSync(path.join(dirA, name)).toString('base64'),
      imgB: readFileSync(path.join(dirB, name)).toString('base64'),
      threshold: CHANNEL_THRESHOLD,
      mask: STAMP_MASK,
    });
    if ('sizeMismatch' in result) {
      rows.push(`| ${layar} | ukuran beda (${result.sizeMismatch}) |`);
      continue;
    }
    writeFileSync(path.join(outDir, name), Buffer.from(result.side, 'base64'));
    rows.push(`| ${layar} | ${result.percent.toFixed(2)}% |`);
  }
  console.log(
    `Perbandingan ${dirA} (A) vs ${dirB} (B), ambang beda kanal > ${CHANNEL_THRESHOLD}\n`,
  );
  console.log('| Layar | Piksel berbeda |\n| --- | ---: |');
  console.log(rows.join('\n'));
  console.log(`\nGambar berdampingan (A | B | selisih): ${outDir}`);
} finally {
  await browser.close();
}
