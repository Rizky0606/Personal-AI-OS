import { expect, login, prepare, test } from './fixtures';

test('jadwal: bahasa alami → hasil parse dikonfirmasi → tersimpan → jalankan sekarang', async ({
  page,
}) => {
  await prepare(page);
  await login(page);

  await page.keyboard.press('Control+4');
  await page.getByRole('button', { name: 'Jadwal baru' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByLabel('Kapan dan apa yang dikerjakan')
    .fill('Setiap Senin 07.00 ringkas berita AI');
  await dialog.getByRole('button', { name: 'Baca jadwal' }).click();

  // Hasil parse ditampilkan untuk dikonfirmasi sebelum disimpan.
  await expect(dialog.getByText('0 7 * * 1')).toBeVisible();
  await dialog.getByRole('button', { name: 'Simpan jadwal' }).click();

  // Detail jadwal: jalankan sekarang menghasilkan riwayat.
  await expect(page.getByRole('heading', { name: 'Ringkasan berita AI' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Jalankan sekarang' }).first().click();
  await expect(
    page
      .getByText('Jadwal dijalankan.')
      .or(page.getByText(/dijalankan/i))
      .first(),
  ).toBeVisible();
});
