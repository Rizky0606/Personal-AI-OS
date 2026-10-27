import { control, expect, login, prepare, test } from './fixtures';

test('run coding: izin → diff → terima membuat commit Conventional di branch run; branch kerja tidak berubah sebelum diterima', async ({
  page,
}) => {
  test.skip(!(await control.hasOmp()), 'omp tidak terpasang di mesin ini');
  const repo = await control.repo();
  const mainBefore = await control.git(repo, 'rev-parse', 'main');
  await prepare(page, { pickFolder: repo });
  await login(page);

  // Daftarkan project: pilih folder, izinkan, daftarkan.
  await page.keyboard.press('Control+2');
  await page.getByRole('link', { name: 'Kelola project' }).click();
  await page.getByRole('button', { name: 'Tambah project' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Tambah project' });
  await dialog.getByRole('button', { name: 'Pilih folder' }).click();
  await dialog.getByRole('button', { name: 'Izinkan folder ini' }).click();
  await dialog.getByRole('button', { name: 'Daftarkan project' }).click();
  await expect(page.getByText('Project terdaftar.').first()).toBeVisible();

  // Pilih project di tab Project: chat-nya sesuai folder project itu.
  await page.keyboard.press('Control+2');
  await page.getByRole('list', { name: 'Daftar project' }).getByRole('link').first().click();

  await page.getByRole('textbox', { name: 'Pesan' }).fill('Tolong tambahkan file catatan e2e.');
  await page.getByRole('button', { name: 'Kirim' }).click();

  // Agent meminta izin menulis file.
  await expect(page.getByText('Agent meminta izin menulis file')).toBeVisible();
  await page.getByRole('button', { name: 'Izinkan sekali' }).click();

  // Selesai: panel Diff terbuka otomatis dengan berkas baru.
  const diff = page.getByRole('complementary');
  await expect(diff.getByText('catatan-e2e.txt').first()).toBeVisible({ timeout: 60_000 });
  // Branch kerja pengguna belum berubah.
  expect(await control.git(repo, 'rev-parse', 'main')).toBe(mainBefore);

  await diff.getByRole('button', { name: 'Terima', exact: true }).click();
  const accept = page.getByRole('dialog', { name: 'Terima perubahan' });
  await expect(accept.getByLabel('Pesan commit')).toHaveValue('docs: tambah catatan e2e');
  await accept.getByRole('button', { name: 'Terima', exact: true }).click();
  await expect(page.getByText(/Diterima. Perubahan ada di branch/).first()).toBeVisible();

  // Satu commit Conventional di branch aios/..., main tetap.
  const branches = await control.git(repo, 'branch', '--list', 'aios/*');
  const branch = branches.replace('*', '').trim();
  expect(branch).toMatch(/^aios\//);
  expect(await control.git(repo, 'log', '-1', '--format=%s', branch)).toBe(
    'docs: tambah catatan e2e',
  );
  expect(await control.git(repo, 'rev-parse', 'main')).toBe(mainBefore);
});
