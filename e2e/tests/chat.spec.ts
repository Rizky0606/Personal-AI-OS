import { control, expect, login, prepare, test } from './fixtures';

test('chat: jawaban mengalir bertahap, role terlihat, judul otomatis, dan riwayat bertahan', async ({
  page,
}) => {
  await prepare(page);
  const config = await control.config();
  await login(page);

  const field = page.getByRole('textbox', { name: 'Pesan' });
  await field.fill('Halo, tolong jelaskan apa itu closure.');
  await page.getByRole('button', { name: 'Kirim' }).click();

  // Streaming sungguhan: potongan pertama muncul sebelum jawaban lengkap.
  const log = page.getByRole('main');
  await expect(log.getByText(/^Halo!/)).toBeVisible();
  await expect(log.getByText(config.hermesAnswer)).toBeVisible();

  // Pesan pengguna dan chip role (router memilih Umum).
  await expect(log.getByText('Halo, tolong jelaskan apa itu closure.')).toBeVisible();
  await expect(log.getByText('Umum').first()).toBeVisible();

  // Judul otomatis di sidebar.
  await expect(page.getByRole('complementary').getByText('Judul uji')).toBeVisible();

  // Muat ulang: percakapan dan jawabannya tetap ada.
  await page.reload();
  await page.getByRole('complementary').getByText('Judul uji').click();
  await expect(page.getByRole('main').getByText(config.hermesAnswer)).toBeVisible();
});
