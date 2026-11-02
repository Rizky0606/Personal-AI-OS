import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from '@playwright/test';
import { preview } from 'vite';
import { installE2eGlobals, scrollMainContent } from './in-page.js';
import { startStack } from './stack.js';

/**
 * `pnpm shots <kode-sesi>`: membangun ulang app e2e, menyalakan stack e2e, lalu memotret layar utama
 * 1440x900 (tema gelap dan terang) ke docs/screenshots/<kode-sesi>/<tema>-<layar>.png. Sebelum memotret,
 * cap build di halaman (data-build-commit) harus sama dengan HEAD; bila beda, gagal ("build basi").
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const code = process.argv[2];
if (!code || !/^[\w.-]+$/.test(code)) {
  console.error('Pemakaian: pnpm shots <kode-sesi>   (mis. pnpm shots p1)');
  process.exit(2);
}
const outDir = path.join(root, 'docs', 'screenshots', code);
const head = () =>
  execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

const THEMES = ['gelap', 'terang'] as const;

interface Config {
  gatewayUrl: string;
  password: string;
  hermesAnswer: string;
}

async function main() {
  // SHOTS_SKIP_BUILD=1 hanya untuk menguji penjaga "build basi"; jalan normal selalu membangun ulang.
  if (process.env.SHOTS_SKIP_BUILD !== '1') {
    console.log(`[shots] membangun ulang app e2e (HEAD ${head()})`);
    const build = spawnSync('pnpm', ['--filter', '@aios/e2e', 'run', 'build:app'], {
      cwd: root,
      stdio: 'inherit',
      shell: true,
    });
    if (build.status !== 0) throw new Error('Build app e2e gagal.');
  }

  mkdirSync(outDir, { recursive: true });
  const port = await freePort();
  const server = await preview({
    root: path.join(root, 'apps/desktop'),
    configFile: false,
    build: { outDir: 'dist-e2e' },
    preview: { host: '127.0.0.1', port, strictPort: true },
    logLevel: 'warn',
  });
  const stack = await startStack();
  const browser = await chromium.launch({ channel: process.env.E2E_BROWSER ?? 'msedge' });
  try {
    const get = async <T>(route: string) =>
      (await (await fetch(`${stack.controlUrl}${route}`)).json()) as T;
    const config = await get<Config>('/config');

    for (const theme of THEMES) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        colorScheme: theme === 'gelap' ? 'dark' : 'light',
        reducedMotion: 'reduce',
        baseURL: `http://127.0.0.1:${port}`,
      });
      const page = await context.newPage();
      // Tiap tema memakai repo (project) baru: run tema pertama bisa masih menunggu tinjauan.
      const repo = (await get<{ path: string }>('/repo')).path;
      await page.addInitScript(installE2eGlobals, { controlUrl: stack.controlUrl, pick: repo });
      const shot = async (name: string) => {
        await page.waitForTimeout(250);
        await page.screenshot({ path: path.join(outDir, `${theme}-${name}.png`) });
        console.log(`[shots] ${theme}-${name}.png`);
      };

      await page.goto('/');
      await assertFresh(page);
      await shot('login');

      await page.getByLabel('Alamat server').fill(config.gatewayUrl);
      await page.getByLabel('Password', { exact: true }).fill(config.password);
      await page.getByLabel('Kode TOTP').fill((await get<{ code: string }>('/totp')).code);
      await page.getByRole('button', { name: 'Masuk', exact: true }).click();
      await page.getByRole('navigation', { name: 'Navigasi utama' }).waitFor();

      const field = page.getByRole('textbox', { name: 'Pesan' });
      await field.waitFor();
      await shot('chat-kosong');

      await field.fill('Halo, tolong jelaskan apa itu closure.');
      await page.getByRole('button', { name: 'Kirim' }).click();
      await page.waitForTimeout(500);
      await shot('chat-berjalan');
      await page.getByRole('main').getByText(config.hermesAnswer).waitFor();
      await shot('chat-selesai');

      await page.keyboard.press('Control+J');
      await shot('panel-kanan');
      await page.keyboard.press('Control+J');

      await page.setViewportSize({ width: 1024, height: 900 });
      await shot('lebar-1024');
      await page.setViewportSize({ width: 1440, height: 900 });

      await page.keyboard.press('Control+K');
      await shot('palet');
      await page.keyboard.press('Escape');

      // Skenario run berjalan (Hermes palsu yang bisa diatur): baris aktivitas di dalam jawaban.
      const answer = () => page.getByRole('main').locator('article').last();
      const activityRow = () => answer().getByRole('button', { name: 'Buka aktivitas run' });
      const runScenario = async (marker: string) => {
        await page.keyboard.press('Control+n');
        await field.fill(`${marker} Perbaiki alur masuk.`);
        await page.getByRole('button', { name: 'Kirim', exact: true }).click();
      };
      await runScenario('[skenario:tool]');
      await answer().getByText('pnpm typecheck').first().waitFor();
      await shot('chat-tool3');
      await activityRow().click();
      await shot('chat-tool3-dibuka');
      await answer()
        .getByText(/Selesai · \d+ dtk · 5 langkah/)
        .waitFor({ timeout: 30_000 });
      await activityRow().click();
      await shot('chat-tool-selesai');
      await runScenario('[skenario:error]');
      await answer()
        .getByText(/Selesai · \d+ dtk · 5 langkah/)
        .waitFor({ timeout: 30_000 });
      await shot('chat-error');

      // Panel Progres: rencana 9 langkah yang maju sendiri (skenario rencana), saat langkah 7 dan setelah selesai.
      await runScenario('[skenario:rencana]');
      const stepChip = page.getByRole('button', { name: /^Langkah \d+ dari 9/ });
      await stepChip.filter({ hasText: 'Langkah 7 dari 9' }).waitFor({ timeout: 30_000 });
      await stepChip.click();
      await page.getByRole('region', { name: 'Progres percakapan' }).waitFor();
      await shot('progres-langkah7');
      await stepChip.filter({ hasText: 'Langkah 9 dari 9' }).waitFor({ timeout: 30_000 });
      await page.getByRole('button', { name: 'Kirim', exact: true }).waitFor({ timeout: 30_000 });
      await shot('progres-selesai');
      await page.getByRole('button', { name: '7 langkah sebelumnya' }).click();
      await shot('progres-sebelumnya-dibuka');
      // Panel ditutup lagi supaya layar berikutnya sama seperti sebelumnya.
      await page.keyboard.press('Control+J');
      await page.getByRole('complementary', { name: 'Panel kanan' }).waitFor({ state: 'hidden' });

      await page.keyboard.press('Control+2');
      await page.getByRole('link', { name: 'Kelola project' }).click();
      await page.getByRole('button', { name: 'Tambah project' }).first().click();
      const add = page.getByRole('dialog', { name: 'Tambah project' });
      await add.getByRole('button', { name: 'Pilih folder' }).click();
      await add.getByRole('button', { name: 'Izinkan folder ini' }).click();
      await add.getByRole('button', { name: 'Daftarkan project' }).click();
      await page.getByText('Project terdaftar.').first().waitFor();
      await page.keyboard.press('Control+2');
      await shot('project');

      await page.keyboard.press('Control+3');
      await page.getByRole('button', { name: /^Project:/ }).click();
      await page.getByRole('menuitemradio', { name: path.basename(repo) }).click();
      await shot('kanban');

      await page.keyboard.press('Control+4');
      await shot('jadwal');
      await page.keyboard.press('Control+5');
      await shot('riset');
      await page.getByRole('link', { name: 'Ruang', exact: true }).click();
      await shot('ruang');

      await page.keyboard.press('Control+6');
      await page.getByRole('heading', { level: 1 }).first().waitFor();
      await shot('pengaturan-atas');
      await page.evaluate(scrollMainContent);
      await shot('pengaturan-gulir');

      // Menunggu izin: run omp di project berhenti di approval.requested (butuh omp di mesin ini).
      if ((await get<{ omp: boolean }>('/capabilities')).omp) {
        await page.keyboard.press('Control+2');
        await page
          .getByRole('list', { name: 'Daftar project' })
          .getByRole('link', { name: path.basename(repo) })
          .first()
          .click();
        await field.fill('[skenario:izin] Tolong tambahkan file catatan.');
        await page.getByRole('button', { name: 'Kirim', exact: true }).click();
        await page.getByText('Agent meminta izin menulis file').waitFor({ timeout: 30_000 });
        await shot('chat-izin');
        // Ditolak supaya run berikutnya (tema lain) tidak antre di project yang sama.
        await page.getByRole('button', { name: 'Tolak', exact: true }).click();
        await page.getByText('Agent meminta izin menulis file').waitFor({ state: 'detached' });
      } else {
        console.warn('[shots] PERINGATAN: omp tidak terpasang; layar chat-izin dilewati.');
      }

      await context.close();
    }
    console.log(`[shots] selesai: ${path.relative(root, outDir)} (commit ${head()})`);
  } finally {
    await browser.close();
    await stack.stop();
    await new Promise((resolve) => server.httpServer.close(resolve));
  }
}

/** Menolak memotret bila build di halaman bukan dari HEAD saat ini. */
async function assertFresh(page: Page) {
  const appRoot = page.locator('#root');
  const stamp = await appRoot.getAttribute('data-build-commit', { timeout: 15_000 });
  if (stamp !== head())
    throw new Error(
      `build basi: halaman ${String(stamp)} != HEAD ${head()}. Bangun ulang app e2e.`,
    );
  if ((await appRoot.getAttribute('data-build-dirty')) === 'true')
    console.warn(
      '[shots] PERINGATAN: ada perubahan belum di-commit; cap hash tidak mewakili isi build.',
    );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
