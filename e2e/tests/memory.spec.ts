import { expect, login, prepare, test } from './fixtures';

test('memori: tambah di Pengaturan, simpan pesan lewat Ingat, nonaktifkan, dan bertahan setelah muat ulang', async ({
  page,
}) => {
  await prepare(page);
  await login(page);

  // Ingat dari pesan chat.
  await page.getByRole('textbox', { name: 'Pesan' }).fill('Saya lebih suka jawaban singkat.');
  await page.getByRole('button', { name: 'Kirim' }).click();
  const log = page.getByRole('main');
  const mine = log.getByRole('article', { name: 'Anda' }).last();
  await expect(mine).toBeVisible();
  await mine.hover();
  await mine.getByRole('button', { name: 'Ingat' }).click();
  const dialog = page.getByRole('dialog', { name: 'Ingat ini' });
  await expect(dialog.getByRole('textbox', { name: 'Fakta baru' })).toHaveValue(
    'Saya lebih suka jawaban singkat.',
  );
  await dialog.getByRole('button', { name: 'Simpan ke memori' }).click();
  await expect(dialog).toBeHidden();

  // Tambah langsung di Pengaturan.
  await page.goto('/#/settings');
  const section = page.getByRole('region', { name: 'Memori' });
  await section.getByRole('textbox', { name: 'Fakta baru' }).fill('Saya memakai Windows 11.');
  await section.getByRole('button', { name: 'Simpan ke memori' }).click();

  const list = section.getByRole('list', { name: 'Daftar memori' });
  await expect(list.getByText('Saya lebih suka jawaban singkat.')).toBeVisible();
  await expect(list.getByText('Saya memakai Windows 11.')).toBeVisible();

  await list.getByRole('switch', { name: /Windows 11/ }).click();
  await expect(list.getByRole('switch', { name: /Windows 11/ })).toHaveAttribute(
    'aria-checked',
    'false',
  );

  await page.reload();
  const again = page
    .getByRole('region', { name: 'Memori' })
    .getByRole('list', { name: 'Daftar memori' });
  await expect(again.getByText('Saya lebih suka jawaban singkat.')).toBeVisible();
  await expect(again.getByRole('switch', { name: /Windows 11/ })).toHaveAttribute(
    'aria-checked',
    'false',
  );
});
