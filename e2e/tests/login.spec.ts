import { control, expect, login, prepare, test } from './fixtures';

test.describe('login', () => {
  test('password salah ditolak dengan pesan; login benar masuk ke aplikasi dan bertahan setelah muat ulang', async ({
    page,
  }) => {
    await prepare(page);
    const config = await control.config();
    await page.goto('/');

    await page.getByLabel('Alamat server').fill(config.gatewayUrl);
    await page.getByLabel('Password', { exact: true }).fill('password-salah-sekali');
    await page.getByLabel('Kode TOTP').fill(await control.totp());
    await page.getByRole('button', { name: 'Masuk', exact: true }).click();
    await expect(page.getByText('Password atau kode TOTP salah')).toBeVisible();

    await login(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Chat' })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('navigation', { name: 'Navigasi utama' })).toBeVisible();
  });
});
