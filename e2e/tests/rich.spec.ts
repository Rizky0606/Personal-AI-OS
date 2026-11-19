import { expect, login, prepare, test } from './fixtures';

test('[skenario:kaya]: tabel, grafik, dan checklist tampil; blok rusak tampil sebagai cadangan ramah tanpa JSON mentah, juga setelah muat ulang', async ({
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
    // Tabel valid: kolom dan baris dari blok aios-ui (di luar cadangan blok rusak).
    const fallback = main.getByRole('region', {
      name: 'Komponen jawaban yang tidak dapat ditampilkan',
    });
    const table = main.getByRole('table').filter({ hasText: 'Postgres' });
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

    // Blok rusak: keterangan + datanya, tidak jadi komponen dan tidak menggagalkan jawaban. JSON mentah hanya di
    // balik "Lihat data mentah" yang tertutup (laporan uji umum B1).
    await expect(fallback).toHaveCount(1);
    await expect(fallback.getByText('Komponen tidak dapat ditampilkan; datanya:')).toBeVisible();
    await expect(fallback.getByRole('cell', { name: 'satu' })).toBeVisible();
    await expect(fallback.getByText('"id":"rusak"')).toBeHidden();
    await expect(fallback.getByText('Lihat data mentah')).toBeVisible();
    await expect(main.getByText('Selesai.', { exact: true })).toBeVisible();
  };
  await check();

  // Muat ulang: jawaban dirender ulang dari riwayat dengan hasil yang sama.
  await page.reload();
  await page.getByRole('complementary').getByText('Judul uji').first().click();
  await check();
});
