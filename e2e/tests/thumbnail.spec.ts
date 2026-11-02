import { expect, login, prepare, test } from './fixtures';

test('[skenario:screenshot]: thumbnail di baris aktivitas dan Output Progres, lightbox dibuka dan ditutup Esc, tahan muat ulang, SVG tampil sebagai berkas', async ({
  page,
}) => {
  await prepare(page);
  await login(page);
  await page
    .getByRole('textbox', { name: 'Pesan' })
    .fill('[skenario:screenshot] Ambil tangkapan layar halaman login.');
  await page.getByRole('button', { name: 'Kirim', exact: true }).click();

  const main = page.getByRole('main');
  await expect(main.getByText(/diagramnya terlampir\./)).toBeVisible({ timeout: 30_000 });

  const assertActivityRow = async () => {
    const answer = main.locator('article').last();
    // PNG: tombol pratinjau dengan gambar nyata (terunduh lewat endpoint terautentikasi).
    const png = answer.getByRole('button', { name: 'Preview: login-form.png' });
    await expect(png.locator('img')).toBeVisible();
    // Gambar benar-benar termuat (bukan ikon rusak): lebar alami terbaca.
    await expect
      .poll(() => png.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0);
    // SVG: tampil sebagai berkas (nama), tanpa gambar.
    const svg = answer.getByRole('button', { name: 'Preview: diagram.svg' });
    await expect(svg).toBeVisible();
    await expect(svg.locator('img')).toHaveCount(0);
  };
  await assertActivityRow();

  // Klik thumbnail membuka lightbox dengan gambarnya; Esc menutup.
  await main
    .locator('article')
    .last()
    .getByRole('button', { name: 'Preview: login-form.png' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'login-form.png' });
  await expect(dialog.getByRole('img', { name: 'login-form.png' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // SVG tidak dirender sebagai gambar bahkan di lightbox.
  await main
    .locator('article')
    .last()
    .getByRole('button', { name: 'Preview: diagram.svg' })
    .click();
  const svgDialog = page.getByRole('dialog', { name: 'diagram.svg' });
  await expect(
    svgDialog.getByText('Berkas diagram.svg tidak bisa dipratinjau di sini.'),
  ).toBeVisible();
  await expect(svgDialog.getByRole('img')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(svgDialog).toBeHidden();

  // Output panel Progres: PNG sebagai gambar dengan thumbnail, SVG sebagai berkas dengan ikon saja.
  await page.keyboard.press('Control+.');
  const panel = page.getByRole('region', { name: 'Progres percakapan' });
  await expect(panel).toBeVisible();
  const assertOutputs = async () => {
    const outputs = panel.getByRole('list', { name: 'Output' });
    await expect(outputs.getByRole('listitem')).toHaveCount(2);
    const image = outputs.getByRole('button', { name: 'Buka Gambar: login-form.png' });
    await expect(image.locator('img')).toBeVisible();
    const file = outputs.getByRole('button', { name: 'Buka Berkas: diagram.svg' });
    await expect(file).toBeVisible();
    await expect(file.locator('img')).toHaveCount(0);
    await expect(outputs.getByRole('button', { name: /Buka Gambar: diagram\.svg/ })).toHaveCount(0);
  };
  await assertOutputs();

  // Klik kartu gambar membuka lightbox; Esc menutup.
  await panel
    .getByRole('list', { name: 'Output' })
    .getByRole('button', { name: 'Buka Gambar: login-form.png' })
    .click();
  await expect(page.getByRole('dialog', { name: 'login-form.png' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'login-form.png' })).toBeHidden();

  // Muat ulang: thumbnail di baris aktivitas dan kartu Output tetap ada (dari event tersimpan).
  await page.reload();
  await page.getByRole('complementary').getByText('Judul uji').first().click();
  await expect(main.getByText(/diagramnya terlampir\./)).toBeVisible();
  await assertActivityRow();
  await page.keyboard.press('Control+.');
  await expect(panel).toBeVisible();
  await assertOutputs();
});
