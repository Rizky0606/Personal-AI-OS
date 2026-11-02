import { expect, login, prepare, test } from './fixtures';

test('[skenario:kaya]: tabel, grafik, dan checklist tampil; blok rusak tampil sebagai kode, juga setelah muat ulang', async ({
  page,
}) => {
  await prepare(page);
  await login(page);
  await page
    .getByRole('textbox', { name: 'Pesan' })
    .fill('[skenario:kaya] Bandingkan 3 opsi database.');
  await page.getByRole('button', { name: 'Kirim', exact: true }).click();

  const main = page.getByRole('main');
  const check = async () => {
    // Tabel valid: satu tabel saja (blok rusak bukan tabel), dengan kolom dan baris dari blok aios-ui.
    const table = main.getByRole('table');
    await expect(table).toHaveCount(1);
    await expect(table.getByRole('columnheader', { name: 'Opsi' })).toBeVisible();
    await expect(table.getByRole('cell', { name: 'Postgres' })).toBeVisible();
    await expect(table.getByRole('row')).toHaveCount(4);

    // Grafik valid: SVG dengan ringkasan yang bisa dibaca pembaca layar.
    await expect(
      main.getByRole('img', { name: /Biaya per bulan: SQLite 0, Postgres 15, MySQL 10/ }),
    ).toBeVisible();

    // Checklist valid: kotak centang dengan status awal dari blok.
    await expect(main.getByRole('checkbox', { name: 'Atur cadangan harian' })).toBeChecked();
    await expect(
      main.getByRole('checkbox', { name: 'Tambah indeks kolom pencarian' }),
    ).not.toBeChecked();

    // Blok rusak: tampil sebagai kode (teks JSON mentah), tidak jadi komponen dan tidak menggagalkan jawaban.
    await expect(main.getByText('"id":"rusak"')).toBeVisible();
    await expect(main.getByText('Selesai.', { exact: true })).toBeVisible();
  };
  await check();

  // Muat ulang: jawaban dirender ulang dari riwayat dengan hasil yang sama.
  await page.reload();
  await page.getByRole('complementary').getByText('Judul uji').first().click();
  await check();
});
