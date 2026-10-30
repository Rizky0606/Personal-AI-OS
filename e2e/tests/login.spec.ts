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

  test('alur ringkas: satu layar langsung terhubung; tombol tampilkan di dalam ruas; galat server tak terjangkau berbeda dari kredensial salah', async ({
    page,
  }) => {
    await prepare(page);
    await page.goto('/');

    // Satu layar: alamat server, password, TOTP, dan satu tombol Masuk; tanpa langkah Pengaturan.
    await expect(page.getByLabel('Alamat server')).toBeVisible();
    await expect(page.getByLabel('Kode TOTP')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Masuk', exact: true })).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'Pengaturan' })).toHaveCount(0);

    // Tampilkan password berada di dalam ruas input yang sama.
    const password = page.getByLabel('Password', { exact: true });
    await password.fill('rahasia');
    await expect(password).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: 'Tampilkan password' }).click();
    await expect(password).toHaveAttribute('type', 'text');
    // Tombol berada di dalam bidang ruas (secara visual), bukan di sampingnya.
    const field = await password.locator('xpath=..').boundingBox();
    const toggle = await page.getByRole('button', { name: 'Sembunyikan password' }).boundingBox();
    expect(field).not.toBeNull();
    expect(toggle).not.toBeNull();
    expect(toggle!.x).toBeGreaterThanOrEqual(field!.x);
    expect(toggle!.x + toggle!.width).toBeLessThanOrEqual(field!.x + field!.width + 1);
    expect(toggle!.y).toBeGreaterThanOrEqual(field!.y - 1);
    expect(toggle!.y + toggle!.height).toBeLessThanOrEqual(field!.y + field!.height + 1);

    // Server tak terjangkau: pesan khusus, bukan "kredensial salah".
    await page.getByLabel('Alamat server').fill('http://127.0.0.1:9');
    await page.getByLabel('Kode TOTP').fill('123456');
    await page.getByRole('button', { name: 'Masuk', exact: true }).click();
    await expect(page.getByText(/Server tidak terjangkau/)).toBeVisible();
    await expect(page.getByText(/Password atau kode TOTP salah/)).toHaveCount(0);
  });
});
