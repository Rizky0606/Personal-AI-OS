import { control, expect, login, prepare, test } from './fixtures';

test('kanban: kartu baru, pindah dengan keyboard, pecah dengan AI, dan Kerjakan dengan AI memindahkan ke Running', async ({
  page,
}) => {
  const repo = await control.repo();
  await prepare(page, { pickFolder: repo });
  await login(page);

  await page.keyboard.press('Control+2');
  await page.getByRole('link', { name: 'Kelola project' }).click();
  await page.getByRole('button', { name: 'Tambah project' }).first().click();
  const add = page.getByRole('dialog', { name: 'Tambah project' });
  await add.getByRole('button', { name: 'Pilih folder' }).click();
  await add.getByRole('button', { name: 'Izinkan folder ini' }).click();
  await add.getByRole('button', { name: 'Daftarkan project' }).click();
  await expect(page.getByText('Project terdaftar.').first()).toBeVisible();

  await page.keyboard.press('Control+3');
  await page.getByRole('button', { name: /^Project:/ }).click();
  await page.getByRole('menuitemradio').first().click();

  // Kartu baru.
  await page.getByRole('button', { name: 'Kartu baru' }).first().click();
  const card = page.getByRole('dialog', { name: 'Kartu baru' });
  await card.getByLabel('Judul').fill('Tambah halaman profil');
  await card.getByLabel('Deskripsi').fill('Tampilkan nama dan email.');
  await card.getByRole('button', { name: 'Simpan' }).click();
  const backlog = page.getByRole('region', { name: /^Backlog, 1 kartu/ });
  await expect(backlog.getByText('Tambah halaman profil')).toBeVisible();

  // Pindah ke Todo dengan keyboard (Alt + panah kanan pada judul kartu).
  await backlog.getByRole('button', { name: /^(?!Menu kartu).*Tambah halaman profil$/ }).focus();
  await page.keyboard.press('Alt+ArrowRight');
  await expect(
    page.getByRole('region', { name: /^Todo, 1 kartu/ }).getByText('Tambah halaman profil'),
  ).toBeVisible();

  // Pecah dengan AI: usulan dipilih, hanya yang dicentang disimpan.
  await page.getByRole('button', { name: 'Pecah dengan AI' }).first().click();
  const split = page.getByRole('dialog', { name: 'Pecah dengan AI' });
  await split.getByLabel('Ide').fill('Buat sistem login lengkap');
  await split.getByRole('button', { name: 'Usulkan kartu' }).click();
  await expect(split.getByText('Buat halaman login')).toBeVisible();
  await split.getByRole('checkbox', { name: /Tulis catatan rilis/ }).uncheck();
  await split.getByRole('button', { name: 'Simpan 2 kartu' }).click();
  const backlogAfter = page.getByRole('region', { name: /^Backlog, 2 kartu/ });
  await expect(backlogAfter.getByText('Buat halaman login')).toBeVisible();
  await expect(backlogAfter.getByText('Tulis catatan rilis')).toHaveCount(0);

  // Kerjakan dengan AI: kartu masuk Running (run menunggu izin di percakapannya).
  await page.getByRole('button', { name: 'Menu kartu Tambah halaman profil' }).click();
  await page.getByRole('menuitem', { name: 'Kerjakan dengan AI' }).click();
  await expect(
    page.getByRole('region', { name: /^Running, 1 kartu/ }).getByText('Tambah halaman profil'),
  ).toBeVisible();
});
