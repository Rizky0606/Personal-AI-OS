import { expect, login, prepare, test } from './fixtures';

test('jadwal: bahasa alami → hasil parse dikonfirmasi → tersimpan → jalankan sekarang', async ({
  page,
}) => {
  await prepare(page);
  await login(page);

  await page.keyboard.press('Control+4');
  await page.getByRole('button', { name: 'Jadwal baru' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByLabel('Kapan dan apa yang dikerjakan')
    .fill('Setiap Senin 07.00 ringkas berita AI');
  await dialog.getByRole('button', { name: 'Baca jadwal' }).click();

  // Hasil parse ditampilkan untuk dikonfirmasi sebelum disimpan.
  await expect(dialog.getByText('0 7 * * 1')).toBeVisible();
  await dialog.getByRole('button', { name: 'Simpan jadwal' }).click();

  // Detail jadwal: tunggu pindah ke halaman detail jadwal ini (bukan daftar atau elemen lain dengan nama sama),
  // lalu bekerja hanya di area utama supaya tidak terkena tombol atau judul di sidebar dan layar lain.
  await expect(page).toHaveURL(/#\/schedules\/[0-9a-f-]{36}$/);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1, name: 'Ringkasan berita AI' })).toBeVisible();
  // Dua tombol sah (kontrol dan keadaan riwayat kosong); yang pertama adalah kontrol di area utama.
  await main.getByRole('button', { name: 'Jalankan sekarang', exact: true }).first().click();
  await expect(page.getByText('Jadwal dijalankan.', { exact: true })).toBeVisible();
});
