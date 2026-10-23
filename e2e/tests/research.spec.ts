import { expect, login, prepare, test } from './fixtures';

test('riset: pertanyaan → pipeline berjalan → laporan dengan rujukan bernomor', async ({
  page,
}) => {
  await prepare(page);
  await login(page);

  await page.keyboard.press('Control+5');
  await page
    .getByRole('textbox', { name: 'Pertanyaan riset' })
    .fill('Bagaimana perkembangan kendaraan listrik?');
  await page.getByRole('radio', { name: 'Cepat' }).click();
  await page.getByRole('button', { name: 'Mulai riset' }).click();

  // Layar detail: laporan muncul dengan rujukan [n] yang bisa dibaca.
  await expect(page.getByRole('heading', { name: 'Laporan' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Laporan riset kendaraan listrik/).first()).toBeVisible({
    timeout: 60_000,
  });
  const main = page.getByRole('main');
  await expect(main.getByText(/\[\d+\]/).first()).toBeVisible();
});
