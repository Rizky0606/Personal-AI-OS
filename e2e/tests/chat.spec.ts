import type { Page } from '@playwright/test';
import { control, expect, login, prepare, test } from './fixtures';

test('chat: jawaban mengalir bertahap, role terlihat, judul otomatis, dan riwayat bertahan', async ({
  page,
}) => {
  await prepare(page);
  const config = await control.config();
  await login(page);

  const field = page.getByRole('textbox', { name: 'Pesan' });
  await field.fill('Halo, tolong jelaskan apa itu closure.');
  await page.getByRole('button', { name: 'Kirim', exact: true }).click();

  // Streaming sungguhan: potongan pertama muncul sebelum jawaban lengkap.
  const log = page.getByRole('main');
  await expect(log.getByText(/^Halo!/)).toBeVisible();
  await expect(log.getByText(config.hermesAnswer)).toBeVisible();

  // Pesan pengguna dan chip role (agent umum).
  await expect(log.getByText('Halo, tolong jelaskan apa itu closure.')).toBeVisible();
  await expect(log.getByText('Umum').first()).toBeVisible();

  // Judul otomatis di sidebar.
  await expect(page.getByRole('complementary').getByText('Judul uji').first()).toBeVisible();

  // Muat ulang: percakapan dan jawabannya tetap ada.
  await page.reload();
  // Daftar terbaru dulu: percakapan tes ini yang paling atas.
  await page.getByRole('complementary').getByText('Judul uji').first().click();
  await expect(page.getByRole('main').getByText(config.hermesAnswer)).toBeVisible();
});

test('chat: aktivitas run dapat dibuka dan menampilkan ringkasan terminal', async ({ page }) => {
  await prepare(page);
  await login(page);
  const field = page.getByRole('textbox', { name: 'Pesan' });
  await field.fill('Jalankan pemeriksaan singkat.');
  await page.getByRole('button', { name: 'Kirim', exact: true }).click();
  const activity = page.getByRole('button', { name: /aktivitas run/i });
  await expect(activity).toBeVisible();
  await activity.click();
  await expect(activity).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText(/Selesai|Gagal|Dibatalkan/).last()).toBeVisible();
});

const orbState = (page: Page) => page.getByTestId('agent-orb').last().getAttribute('data-state');

async function send(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'Pesan' }).fill(text);
  await page.getByRole('button', { name: 'Kirim', exact: true }).click();
}

test('[skenario:tool]: baris aktivitas hidup di dalam jawaban, Orb mengikuti fase, ringkasan setelah selesai dan setelah muat ulang', async ({
  page,
}) => {
  await prepare(page);
  await login(page);
  await send(page, '[skenario:tool] Perbaiki alur masuk.');

  const answer = page.getByRole('main').locator('article').last();
  const row = answer.getByRole('button', { name: 'Buka aktivitas run' });
  // Judul abu dari kalimat pertama penalaran, di dalam jawaban.
  await expect(answer.locator('[aria-live]')).toContainText(
    'Aku perlu membaca login.ts dulu untuk memahami alur masuknya',
  );

  // Tool ke-3 berjalan: baris terlipat memuat aksi, target redup, timer, dan +2.
  await expect(row).toContainText('Menjalankan perintah', { timeout: 20_000 });
  await expect(row).toContainText('pnpm typecheck');
  await expect(row).toContainText('+2');
  await expect(row).toContainText(/\d+ dtk/);
  await expect(row).toHaveAttribute('aria-expanded', 'false');
  expect(await orbState(page)).toBe('tool');

  // Baris berada di kolom jawaban (bukan selebar layar) dan di antara meta dan isi.
  const rowBox = (await row.boundingBox())!;
  const mainBox = (await page.getByRole('main').boundingBox())!;
  expect(rowBox.width).toBeLessThan(mainBox.width * 0.75);
  const metaBox = (await answer.locator('header').boundingBox())!;
  expect(rowBox.y).toBeGreaterThan(metaBox.y);

  // Selesai: ringkasan terlipat, Orb done, tanpa chip tool di luar linimasa.
  await expect(row).toContainText(/Selesai · \d+ dtk · 5 langkah/, { timeout: 30_000 });
  await expect(answer.getByText('memeriksa sandi kosong.')).toBeVisible();
  await expect.poll(() => orbState(page)).toBe('done');
  await expect(answer.getByRole('list', { name: 'Linimasa langkah' })).toHaveCount(0);

  // Dibuka: linimasa 5 langkah dengan durasi.
  await row.click();
  const steps = answer.getByRole('list', { name: 'Linimasa langkah' }).getByRole('listitem');
  await expect(steps).toHaveCount(5);
  await expect(steps.nth(2)).toContainText('pnpm typecheck');
  await expect(steps.nth(2)).toContainText(/\d+(,\d)? dtk|\d+ ms/);

  // Muat ulang: jawaban lama tetap punya ringkasan terlipat (durasi hanya bila server memberinya).
  await page.reload();
  await page.getByRole('complementary', { name: 'Daftar' }).getByText('Judul uji').first().click();
  const old = page.getByRole('main').locator('article').last();
  await expect(old.getByRole('button', { name: 'Buka aktivitas run' })).toContainText(
    /Selesai · (\d+ (dtk|mnt)[^·]*· )?5 langkah/,
  );
  await expect(old.getByRole('button', { name: 'Buka aktivitas run' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
});

test('[skenario:error]: tool ke-3 gagal; linimasa terbuka sendiri dan menandai langkah gagal', async ({
  page,
}) => {
  await prepare(page);
  await login(page);
  await send(page, '[skenario:error] Perbaiki alur masuk.');

  const answer = page.getByRole('main').locator('article').last();
  const row = answer.getByRole('button', { name: 'Buka aktivitas run' });
  await expect(row).toContainText(/Selesai · \d+ dtk · 5 langkah/, { timeout: 40_000 });
  // Galat tool membuka linimasa tanpa diminta.
  await expect(row).toHaveAttribute('aria-expanded', 'true');
  const steps = answer.getByRole('list', { name: 'Linimasa langkah' }).getByRole('listitem');
  await expect(steps).toHaveCount(5);
  await expect(steps.nth(2)).toContainText('Perintah gagal');
  await expect(steps.nth(1)).not.toContainText('gagal');
});

test('[skenario:izin]: berhenti di approval.requested; baris menunggu izin, Orb tool, panel izin terlihat', async ({
  page,
}) => {
  test.skip(!(await control.hasOmp()), 'omp tidak terpasang di mesin ini');
  const repo = await control.repo();
  await prepare(page, { pickFolder: repo });
  await login(page);
  await page.keyboard.press('Control+2');
  await page.getByRole('link', { name: 'Kelola project' }).click();
  await page.getByRole('button', { name: 'Tambah project' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Tambah project' });
  await dialog.getByRole('button', { name: 'Pilih folder' }).click();
  await dialog.getByRole('button', { name: 'Izinkan folder ini' }).click();
  await dialog.getByRole('button', { name: 'Daftarkan project' }).click();
  await expect(page.getByText('Project terdaftar.').first()).toBeVisible();
  await page.keyboard.press('Control+2');
  await page.getByRole('list', { name: 'Daftar project' }).getByRole('link').first().click();

  await send(page, '[skenario:izin] Tolong tambahkan file catatan.');
  await expect(page.getByText('Agent meminta izin menulis file')).toBeVisible({ timeout: 30_000 });

  const answer = page.getByRole('main').locator('article').last();
  const row = answer.getByRole('button', { name: 'Buka aktivitas run' });
  await expect(row).toContainText('Menunggu izin');
  await expect(row).toHaveAttribute('aria-expanded', 'true');
  expect(await orbState(page)).toBe('tool');
  // Tidak ada keputusan: run tetap menunggu.
  await expect(answer.getByRole('button', { name: /Buka approval/ })).toBeVisible();
});

test('composer: Kirim berubah jadi Hentikan dan bingkai berwarna fase selama run berjalan', async ({
  page,
}) => {
  await prepare(page);
  await login(page);
  await send(page, '[skenario:tool] Perbaiki alur masuk.');

  const frame = page.locator('.aios-composer-frame');
  await expect(page.getByRole('button', { name: 'Hentikan' })).toBeVisible();
  await expect(frame).toHaveAttribute('data-phase', /thinking|tool|writing/);
  // Bingkai benar-benar berwarna fase (bukan border bawaan).
  const [phaseColor, baseColor] = await frame.evaluate((el) => {
    const probe = document.createElement('div');
    probe.className = 'border border-border';
    document.body.appendChild(probe);
    const base = getComputedStyle(probe).borderTopColor;
    probe.remove();
    return [getComputedStyle(el).borderTopColor, base];
  });
  expect(phaseColor).not.toBe(baseColor);
  await expect(page.getByRole('button', { name: 'Kirim', exact: true })).toBeVisible({
    timeout: 40_000,
  });
});

test('[skenario:rencana]: chip maju "Langkah 1 dari 9" sampai "9 dari 9", panel Progres berisi tiga bagian, dan tetap sama setelah muat ulang', async ({
  page,
}) => {
  await prepare(page);
  await login(page);
  // Perekam: mencatat tiap nilai chip yang pernah tampil (polling bisa melewatkan langkah 600 ms).
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __chips: string[] }).__chips = seen;
    const read = () => {
      const label = document
        .querySelector('button[aria-keyshortcuts="Control+."]')
        ?.getAttribute('aria-label');
      if (label && seen.at(-1) !== label) seen.push(label);
    };
    new MutationObserver(read).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-label'],
    });
  });
  await send(page, '[skenario:rencana] Perbaiki alur masuk.');

  // Chip di topbar berganti satu per satu mengikuti rencana (tiap langkah 600 ms).
  const chip = page.getByRole('button', { name: /^Langkah \d+ dari 9/ });
  await expect(chip).toContainText('Langkah 9 dari 9', { timeout: 30_000 });
  const seen = await page.evaluate(() => (window as unknown as { __chips: string[] }).__chips);
  const numbers = seen.map((label) => Number(/^Langkah (\d+) dari 9/.exec(label)?.[1]));
  expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  await expect(chip).toHaveAttribute('aria-label', /^Langkah 9 dari 9: Periksa hasil$/);

  // Klik chip membuka panel kanan di tab Progres (tab pertama).
  await chip.click();
  const panel = page.getByRole('region', { name: 'Progres percakapan' });
  await expect(panel).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Progres', selected: true })).toBeVisible();
  await expect(page.getByRole('tab').first()).toHaveAccessibleName('Progres');

  const assertPanel = async () => {
    // (1) Progres: 9 selesai, dua terakhir terlihat, sisanya diringkas.
    const timeline = panel.getByRole('list', { name: 'Linimasa progres' });
    await expect(timeline.getByRole('button', { name: '7 langkah sebelumnya' })).toBeVisible();
    await expect(timeline.getByText('Periksa hasil')).toBeVisible();
    await expect(timeline.getByText('Perbaiki galat tes')).toBeVisible();
    // (2) Output: gambar, berkas, dan perubahan kode.
    const outputs = panel.getByRole('list', { name: 'Output' });
    await expect(outputs.getByRole('listitem')).toHaveCount(3);
    await expect(outputs).toContainText('login-form.png');
    await expect(outputs).toContainText('hasil.md');
    await expect(outputs).toContainText('2 berkas diubah');
    // (3) Digunakan dalam sesi ini.
    const used = panel.getByLabel('Digunakan dalam sesi ini');
    await expect(used).toContainText('desain.png');
    await expect(used).toContainText('plan-progress');
    await expect(used).toContainText('Dibaca · 3 fakta');
    await expect(used).toContainText('hermes');
  };
  await assertPanel();

  // Linimasa dibuka: seluruh 9 langkah terlihat, dibuka dan ditutup lewat tombol.
  const timeline = panel.getByRole('list', { name: 'Linimasa progres' });
  await timeline.getByRole('button', { name: '7 langkah sebelumnya' }).click();
  await expect(timeline.getByRole('listitem')).toHaveCount(9 + 1);
  await expect(timeline.getByRole('button', { name: '7 langkah sebelumnya' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await timeline.getByRole('button', { name: '7 langkah sebelumnya' }).click();

  // Memori: klik membuka judul fakta (bukan isinya).
  await panel.getByRole('button', { name: /Dibaca · 3 fakta/ }).click();
  await expect(
    panel.getByRole('list', { name: 'Fakta memori yang dibaca' }).getByRole('listitem'),
  ).toHaveCount(3);

  // Tunggu jawaban selesai, lalu muat ulang aplikasi: data tahan muat ulang (dari event tersimpan).
  await expect(page.getByRole('button', { name: 'Kirim', exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await page.reload();
  await page.getByRole('complementary', { name: 'Daftar' }).getByText('Judul uji').first().click();
  await expect(page.getByRole('button', { name: /^Langkah 9 dari 9/ })).toBeVisible();
  // Pintasan keyboard dari sumber pintasan yang sama membuka tab Progres.
  await page.keyboard.press('Control+.');
  await expect(panel).toBeVisible();
  await assertPanel();
});
