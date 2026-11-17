import type { Page } from '@playwright/test';
import { control, expect, login, prepare, test } from './fixtures';

/** Mendaftarkan folder repo sebagai project (setelan bawaan: kerja langsung di branch aktif) lalu membuka chat-nya. */
async function openProjectChat(page: Page, repo: string) {
  await prepare(page, { pickFolder: repo });
  await login(page);
  await page.keyboard.press('Control+2');
  await page.getByRole('link', { name: 'Kelola project' }).click();
  await page.getByRole('button', { name: 'Tambah project' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Tambah project' });
  await dialog.getByRole('button', { name: 'Pilih folder' }).click();
  await dialog.getByRole('button', { name: 'Izinkan folder ini' }).click();
  await dialog.getByRole('button', { name: 'Daftarkan project' }).click();
  await expect(page.getByText('Project terdaftar.').first()).toBeVisible();
  await page.keyboard.press('Control+2');
  await page.getByRole('list', { name: 'Daftar project' }).getByRole('link').first().click();
}

async function askForNote(page: Page) {
  await page.getByRole('textbox', { name: 'Pesan' }).fill('Tolong tambahkan file catatan e2e.');
  await page.getByRole('button', { name: 'Kirim', exact: true }).click();
}

test('branch aktif: edit → diff → terima membuat commit di branch yang sedang checkout, tanpa branch aios', async ({
  page,
}) => {
  test.skip(!(await control.hasOmp()), 'omp tidak terpasang di mesin ini');
  const repo = await control.repo();
  const mainBefore = await control.git(repo, 'rev-parse', 'main');
  await openProjectChat(page, repo);

  await askForNote(page);
  await expect(page.getByText('Agent meminta izin menulis file')).toBeVisible();
  await page.getByRole('button', { name: 'Izinkan sekali' }).click();

  const diff = page.getByRole('complementary');
  await expect(diff.getByText('catatan-e2e.txt').first()).toBeVisible({ timeout: 60_000 });
  await expect(diff.getByText('Langsung di branch main')).toBeVisible();
  await expect(page.getByText('Di branch main').first()).toBeVisible();
  // Agent menulis langsung di folder project; belum ada commit dan tidak ada branch atau worktree baru.
  expect(await control.readFile(`${repo}/catatan-e2e.txt`)).toBe('dibuat oleh agent E2E\n');
  expect(await control.git(repo, 'rev-parse', 'main')).toBe(mainBefore);
  expect(await control.git(repo, 'branch', '--list', 'aios/*')).toBe('');
  expect((await control.git(repo, 'worktree', 'list')).split('\n')).toHaveLength(1);

  await diff.getByRole('button', { name: 'Terima', exact: true }).click();
  const accept = page.getByRole('dialog', { name: 'Terima perubahan' });
  await expect(accept.getByText('Perubahan di-commit langsung di branch main.')).toBeVisible();
  await expect(accept.getByRole('switch')).toHaveCount(0);
  await accept.getByRole('button', { name: 'Terima', exact: true }).click();
  await expect(page.getByText('Diterima. Perubahan ada di branch main.').first()).toBeVisible();

  // Satu commit Conventional langsung di main, di atas commit sebelumnya; tanpa branch aios.
  expect(await control.git(repo, 'rev-parse', 'main~1')).toBe(mainBefore);
  expect(await control.git(repo, 'log', '-1', '--format=%s', 'main')).toBe(
    'docs: tambah catatan e2e',
  );
  expect(await control.git(repo, 'branch', '--format=%(refname:short)')).toBe('main');
  expect(await control.git(repo, 'status', '--porcelain')).toBe('');
});

test('branch aktif: tolak mengembalikan folder persis; folder kotor ditolak dengan jalan keluar ke worktree', async ({
  page,
}) => {
  test.skip(!(await control.hasOmp()), 'omp tidak terpasang di mesin ini');
  const repo = await control.repo();
  const mainBefore = await control.git(repo, 'rev-parse', 'main');
  // Berkas yang diabaikan git (seperti node_modules/build) tidak boleh tersentuh tinjauan.
  await control.writeFile(`${repo}/.git/info/exclude`, 'build/\n');
  await control.writeFile(`${repo}/build/lama.txt`, 'hasil build lama\n');
  const readme = await control.readFile(`${repo}/README.md`);
  await openProjectChat(page, repo);

  await askForNote(page);
  await expect(page.getByText('Agent meminta izin menulis file')).toBeVisible();
  await page.getByRole('button', { name: 'Izinkan sekali' }).click();
  const diff = page.getByRole('complementary');
  await expect(diff.getByText('catatan-e2e.txt').first()).toBeVisible({ timeout: 60_000 });
  expect(await control.readFile(`${repo}/catatan-e2e.txt`)).toBe('dibuat oleh agent E2E\n');

  await diff.getByRole('button', { name: 'Tolak semua' }).click();
  const reject = page.getByRole('dialog', { name: 'Tolak semua perubahan?' });
  await expect(reject.getByText(/Isi folder project dikembalikan/)).toBeVisible();
  await reject.getByRole('button', { name: 'Buang perubahan' }).click();
  await expect(page.getByText('Perubahan dibuang.').first()).toBeVisible();

  expect(await control.readFile(`${repo}/catatan-e2e.txt`)).toBeNull();
  expect(await control.readFile(`${repo}/README.md`)).toBe(readme);
  expect(await control.readFile(`${repo}/build/lama.txt`)).toBe('hasil build lama\n');
  expect(await control.git(repo, 'status', '--porcelain')).toBe('');
  expect(await control.git(repo, 'rev-parse', 'main')).toBe(mainBefore);
  expect(await control.git(repo, 'branch', '--list', 'aios/*')).toBe('');

  // Folder kotor: run ditolak, perubahan pemilik tidak disentuh, dan ada jalan keluar satu klik.
  await control.writeFile(`${repo}/README.md`, '# Diubah pemilik\n');
  await askForNote(page);
  await expect(page.getByText(/perubahan yang belum di-commit/).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('button', { name: 'Buka tab Git' })).toBeVisible();
  expect(await control.readFile(`${repo}/README.md`)).toBe('# Diubah pemilik\n');

  await page.getByRole('button', { name: 'Jalankan sekali ini di worktree terpisah' }).click();
  await expect(page.getByText('Agent meminta izin menulis file')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Izinkan sekali' }).click();
  await expect(diff.getByText('catatan-e2e.txt').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/^Di salinan aios\//).first()).toBeVisible();
  // Run worktree: perubahan pemilik tetap, hasil agent di salinan terpisah, bukan di folder project.
  expect(await control.readFile(`${repo}/README.md`)).toBe('# Diubah pemilik\n');
  expect(await control.readFile(`${repo}/catatan-e2e.txt`)).toBeNull();
  expect(await control.git(repo, 'branch', '--list', 'aios/*')).toMatch(/aios\//);
});
