import { control, expect, login, prepare, test } from './fixtures';

test('lampiran: berkas dipilih, diunggah ke gateway, terkirim bersama pesan, dan tetap ada di riwayat', async ({
  page,
}) => {
  await prepare(page);
  const config = await control.config();
  await login(page);

  await page.locator('input[type="file"]').setInputFiles({
    name: 'catatan-rapat.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Rapat\nAnggaran disetujui.'),
  });
  const pending = page.getByRole('list', { name: 'Lampiran' });
  await expect(pending.getByText('catatan-rapat.md')).toBeVisible();
  await expect(pending.getByText('Mengunggah…')).toHaveCount(0);

  await page.getByRole('textbox', { name: 'Pesan' }).fill('Ringkas catatan ini.');
  await page.getByRole('button', { name: 'Kirim' }).click();

  const log = page.getByRole('main');
  await expect(log.getByText(config.hermesAnswer)).toBeVisible();
  const mine = log
    .getByRole('article', { name: 'Anda' })
    .filter({ hasText: 'Ringkas catatan ini.' });
  await expect(mine.getByText('catatan-rapat.md')).toBeVisible();

  // Muat ulang: chip lampiran datang dari server, bukan dari state composer.
  await page.reload();
  await page.getByRole('complementary').getByText('Judul uji').first().click();
  await expect(page.getByRole('main').getByText('catatan-rapat.md')).toBeVisible();
});
