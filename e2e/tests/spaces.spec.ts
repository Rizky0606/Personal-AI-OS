import { expect, login, prepare, test } from './fixtures';

test('ruang: buat, tambah dokumen teks, lalu chat baru terikat ruang', async ({ page }) => {
  await prepare(page);
  await login(page);

  await page.goto('/#/spaces');
  await page.getByRole('textbox', { name: 'Nama ruang' }).fill('Kontrak E2E');
  await page.getByRole('button', { name: 'Buat ruang' }).click();
  await expect(page.getByRole('heading', { name: 'Kontrak E2E' })).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles({
    name: 'kontrak.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(
      'Pasal 7. Keterlambatan pembayaran dikenakan denda 2% per hari.\n\nPasal 9. Berakhir 2027.',
    ),
  });
  const docs = page.getByRole('list', { name: 'Dokumen' });
  await expect(docs.getByText('kontrak.txt')).toBeVisible();
  await expect(docs.getByText(/karakter · \d+ bagian/)).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Daftar ruang' }).getByText('1 dokumen'),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Chat baru di ruang ini' }).click();
  await expect(page).toHaveURL(/#\/chat\//);
  await page.getByRole('textbox', { name: 'Pesan' }).fill('Berapa denda keterlambatan?');
  await page.getByRole('button', { name: 'Kirim' }).click();
  await expect(page.getByRole('main').getByText('Berapa denda keterlambatan?')).toBeVisible();

  // Percakapan muncul di daftar ruang.
  await page.goto('/#/spaces');
  await page.getByRole('navigation', { name: 'Daftar ruang' }).getByText('Kontrak E2E').click();
  await expect(page.getByRole('region', { name: 'Percakapan di ruang ini' })).toBeVisible();
});
