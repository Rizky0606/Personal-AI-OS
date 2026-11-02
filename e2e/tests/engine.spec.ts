import { expect, login, prepare, test } from './fixtures';

test('pilih dsh di composer: tugas berjalan lewat dsh palsu, baris aktivitas dan panel Progres terisi, pilihan bertahan setelah muat ulang', async ({
  page,
}) => {
  await prepare(page);
  await login(page);

  // Pemilih mesin: omp nonaktif di chat umum (butuh project); Hermes dan dsh bisa dipilih; dsh berlabel Pratinjau.
  await page.getByRole('button', { name: /^Mesin:/ }).click();
  const dsh = page.getByRole('menuitemradio', { name: /^dsh/ });
  test.skip(
    (await dsh.getAttribute('aria-disabled')) === 'true',
    'dsh palsu tidak aktif di stack ini (jalur repo memuat spasi)',
  );
  await expect(page.getByRole('menuitemradio', { name: /^omp/ })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await expect(page.getByRole('menuitemradio', { name: /^omp/ })).toContainText(
    'Butuh project: buka chat dari sebuah project.',
  );
  await expect(dsh).toContainText('Pratinjau');
  await dsh.click();
  const pill = page.getByRole('button', { name: 'Mesin: dsh' });
  await expect(pill).toContainText('Pratinjau');
  await expect(pill).toHaveAttribute('title', /belum diaudit/);

  // Kata "izin" membuat dsh palsu meminta izin menjalankan perintah, seperti agen sungguhan.
  await page
    .getByRole('textbox', { name: 'Pesan' })
    .fill('Tolong bersihkan folder build, izin dulu.');
  await page.getByRole('button', { name: 'Kirim', exact: true }).click();

  const answer = page.getByRole('main').locator('article').last();
  await expect(page.getByText('Agent meminta izin menjalankan perintah')).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: 'Izinkan sekali' }).click();
  await expect(answer.getByText('diizinkan')).toBeVisible({ timeout: 30_000 });

  // Baris aktivitas: langkah tool dari dsh tercatat.
  const activity = answer.getByRole('button', { name: /aktivitas run/i });
  await expect(activity).toBeVisible();
  await activity.click();
  await expect(answer.getByText('Perintah selesai')).toBeVisible();
  await expect(answer.getByText('rm -rf build')).toBeVisible();

  // Panel Progres terisi dari run dsh: mesin yang dipakai dan alat yang dijalankan.
  await page.keyboard.press('Control+.');
  const panel = page.getByRole('region', { name: 'Progres percakapan' });
  await expect(panel).toBeVisible();
  const used = panel.getByLabel('Digunakan dalam sesi ini');
  await expect(used).toContainText('dsh');

  // Pilihan mesin tersimpan per percakapan: setelah muat ulang dan membuka percakapan itu, tetap dsh.
  await page.reload();
  await page.getByRole('complementary').getByText('Judul uji').first().click();
  await expect(page.getByRole('button', { name: 'Mesin: dsh' })).toBeVisible();
});

test('mesin yang tidak tersedia tampil nonaktif dengan alasannya, dan Otomatis tidak memakai dsh', async ({
  page,
}) => {
  await prepare(page);
  await login(page);
  await page.getByRole('button', { name: /^Mesin:/ }).click();
  // Tidak ada worker Windows di sesi ini sebagai perangkat tersambung untuk omp bila belum didaftarkan: alasan
  // konteks (butuh project) yang lebih dulu tampil di chat umum.
  const omp = page.getByRole('menuitemradio', { name: /^omp/ });
  await expect(omp).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Escape');

  await page.getByRole('textbox', { name: 'Pesan' }).fill('Halo, sapa aku.');
  await page.getByRole('button', { name: 'Kirim', exact: true }).click();
  // Jawaban Hermes palsu (bukan "halo dari dsh") membuktikan Otomatis tetap lewat Hermes.
  await expect(page.getByRole('main').getByText(/^Halo!/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('main').getByText('halo dari dsh')).toHaveCount(0);
});
