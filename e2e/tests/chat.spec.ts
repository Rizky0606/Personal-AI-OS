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
  await page.getByRole('button', { name: 'Kirim' }).click();
  const activity = page.getByRole('button', { name: /aktivitas run/i });
  await expect(activity).toBeVisible();
  await activity.click();
  await expect(activity).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText(/Selesai|Gagal|Dibatalkan/).last()).toBeVisible();
});
