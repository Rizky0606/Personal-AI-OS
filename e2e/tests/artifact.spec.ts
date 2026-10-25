import { control, expect, login, prepare, test } from './fixtures';

test('artifact: blok HTML di jawaban bisa dipratinjau dan diunduh sebagai ZIP', async ({
  page,
}) => {
  await prepare(page);
  await control.config();
  await login(page);

  await page.getByRole('textbox', { name: 'Pesan' }).fill('Buatkan artifact halaman sapaan.');
  await page.getByRole('button', { name: 'Kirim' }).click();

  const log = page.getByRole('main');
  await expect(log.getByText('<h1 id="judul">Halo artifact</h1>', { exact: false })).toBeVisible();
  // Tombol ZIP baru tampil setelah jawaban selesai mengalir.
  await expect(log.getByRole('button', { name: 'Unduh berkas (ZIP)' })).toBeVisible();

  // Pratinjau menjalankan skrip halaman di iframe sandbox (origin buram, tanpa akses ke aplikasi).
  await log.getByRole('button', { name: 'Pratinjau', exact: true }).click();
  const frame = log.getByTitle('Pratinjau artifact');
  await expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-modals');
  await expect(
    page.frameLocator('iframe[title="Pratinjau artifact"]').getByText('Halo artifact berjalan'),
  ).toBeVisible();
  await expect(
    page.evaluate(() => {
      const iframe = document.querySelector<HTMLIFrameElement>(
        'iframe[title="Pratinjau artifact"]',
      );
      try {
        return iframe?.contentWindow?.document ? 'terbuka' : 'tertutup';
      } catch {
        return 'tertutup';
      }
    }),
  ).resolves.toBe('tertutup');

  // Satu blok kode: tombol ZIP mengunduh satu berkas dengan nama dari pagar kode.
  const download = page.waitForEvent('download');
  await log.getByRole('button', { name: 'Unduh berkas (ZIP)' }).click();
  expect((await download).suggestedFilename()).toMatch(/^kode-\d{12}\.zip$/);
});
