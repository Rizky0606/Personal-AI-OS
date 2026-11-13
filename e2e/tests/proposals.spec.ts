import AxeBuilder from '@axe-core/playwright';
import { control, expect, login, prepare, test } from './fixtures';
import { PROPOSAL_ID, PROPOSAL_NAME, SCENARIO_PROPOSAL } from '../harness/fakes';

/** Indeks skill yang dilihat omp (scope worker); id skill aktif untuk mesin itu. */
const ompIndex = async (): Promise<string[]> => {
  const res = await fetch(`${control.url()}/skills-index?engine=omp`);
  return ((await res.json()) as { items: { id: string }[] }).items.map((s) => s.id);
};

test('usulan skill: jawaban agent -> kartu muncul (blok tidak terlihat) -> tinjau -> setujui -> skill ada di indeks omp', async ({
  page,
}) => {
  await prepare(page);
  await login(page);
  const main = page.getByRole('main');

  await page
    .getByRole('textbox', { name: 'Pesan' })
    .fill(`${SCENARIO_PROPOSAL} Rapikan changelog rilis ini.`);
  await page.getByRole('button', { name: 'Kirim', exact: true }).click();

  // Jawaban utuh, blok usulan tidak pernah terlihat (selama mengalir maupun sesudahnya).
  await expect(main.getByText('Changelog sudah dirapikan.')).toBeVisible({ timeout: 20_000 });
  await expect(main.getByText(/aios-skill-proposal/)).toHaveCount(0);
  await expect(main.getByText(/"kind":"new"/)).toHaveCount(0);

  // Kartu kecil di jawaban; belum ada skill aktif.
  const card = main.getByRole('list', { name: 'Usulan skill' });
  await expect(card.getByText(`Agent mengusulkan skill: ${PROPOSAL_NAME}`)).toBeVisible({
    timeout: 20_000,
  });
  expect(await ompIndex()).not.toContain(PROPOSAL_ID);

  // Panel Progres, bagian Output: kartu jenis "Usulan skill".
  await page.keyboard.press('Control+.');
  const panel = page.getByRole('region', { name: 'Progres percakapan' });
  await expect(panel.getByRole('list', { name: 'Output' }).getByText('Usulan skill')).toBeVisible();

  // Tinjau: halaman Skill terbuka di tab Usulan agent dengan dialog usulan itu.
  await card.getByRole('button', { name: `Tinjau usulan skill ${PROPOSAL_NAME}` }).click();
  await expect(page).toHaveURL(/#\/skills/);
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByText('Langkah ini berulang tiga kali dan bisa dipakai ulang.'),
  ).toBeVisible();
  await expect(dialog.getByText(/Baca commit sejak rilis terakhir/)).toBeVisible();
  await expect(dialog.getByText(/Aman:/)).toBeVisible();
  // Tinjauan tidak mengaktifkan apa pun.
  expect(await ompIndex()).not.toContain(PROPOSAL_ID);

  await dialog.getByRole('button', { name: 'Setujui', exact: true }).click();
  await expect(page.getByText('Usulan disetujui; skill aktif.').first()).toBeVisible();
  await expect(dialog).toBeHidden();

  // Skill muncul di indeks omp (dan mesin lain), sebagai skill source agent.
  await expect.poll(ompIndex, { timeout: 15_000 }).toContain(PROPOSAL_ID);
  await page.getByRole('tab', { name: 'Skill saya' }).click();
  const row = page.getByRole('button', { name: new RegExp(`^${PROPOSAL_NAME}`) });
  await expect(row).toBeVisible();
  await expect(row).toContainText('Usulan agent');

  // Usulan yang sudah disetujui tidak muncul lagi di daftar "Menunggu"; kartu di jawaban menunjukkan keputusan.
  await page.getByRole('tab', { name: /Usulan agent/ }).click();
  await expect(page.getByText('Tidak ada usulan yang menunggu.')).toBeVisible();

  // Bersihkan.
  await page.getByRole('tab', { name: 'Skill saya' }).click();
  await row.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Hapus permanen' }).click();
  await page.getByRole('dialog').last().getByRole('button', { name: 'Hapus', exact: true }).click();
  await expect(row).toBeHidden();
  expect(await ompIndex()).not.toContain(PROPOSAL_ID);
});

test('usulan skill: ditolak dengan alasan tidak pernah menjadi skill', async ({ page }) => {
  await prepare(page);
  await login(page);
  await page
    .getByRole('textbox', { name: 'Pesan' })
    .fill(`${SCENARIO_PROPOSAL} Rapikan changelog yang lain.`);
  await page.getByRole('button', { name: 'Kirim', exact: true }).click();
  const card = page.getByRole('main').getByRole('list', { name: 'Usulan skill' });
  await card.getByRole('button', { name: `Tinjau usulan skill ${PROPOSAL_NAME}` }).click({
    timeout: 30_000,
  });
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Tolak', exact: true }).click();
  await dialog.getByLabel('Alasan menolak (opsional)').fill('Terlalu spesifik.');
  await dialog.getByRole('button', { name: 'Tolak usulan' }).click();
  await expect(page.getByText('Usulan ditolak.').first()).toBeVisible();
  await expect(dialog).toBeHidden();
  expect(await ompIndex()).not.toContain(PROPOSAL_ID);
  await page.getByRole('tab', { name: 'Skill saya' }).click();
  await expect(page.getByRole('button', { name: new RegExp(`^${PROPOSAL_NAME}`) })).toHaveCount(0);
});

for (const theme of ['light', 'dark'] as const) {
  test(`usulan skill: tab Usulan agent, dialog tinjauan, dan kartu bebas pelanggaran WCAG AA (${theme})`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme });
    await prepare(page);
    await login(page);
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    await page
      .getByRole('textbox', { name: 'Pesan' })
      .fill(`${SCENARIO_PROPOSAL} Rapikan changelog untuk pemeriksaan aksesibilitas.`);
    await page.getByRole('button', { name: 'Kirim', exact: true }).click();
    const card = page.getByRole('main').getByRole('list', { name: 'Usulan skill' });
    await expect(card.getByText(`Agent mengusulkan skill: ${PROPOSAL_NAME}`)).toBeVisible({
      timeout: 30_000,
    });
    // Axe menilai kontras hanya setelah animasi selesai; tanpa ini hasilnya bergantung pada kecepatan mesin
    // (lolos di lokal, gagal di CI yang lebih cepat).
    const settle = () =>
      page.evaluate(() =>
        Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
      );
    const scan = async () => {
      await settle();
      return (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze()
      ).violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.slice(0, 3).map((n) => `${n.target.join(' ')} :: ${n.html.slice(0, 260)}`),
      }));
    };
    expect(await scan(), 'jawaban dengan kartu usulan').toEqual([]);

    await card.getByRole('button', { name: `Tinjau usulan skill ${PROPOSAL_NAME}` }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog').getByText(/Aman:/)).toBeVisible();
    expect(await scan(), 'dialog tinjauan usulan').toEqual([]);

    // Bersihkan: tolak supaya tidak tersisa usulan menunggu untuk tes lain.
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Tolak', exact: true }).click();
    await dialog.getByRole('button', { name: 'Tolak usulan' }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole('tab', { name: /Usulan agent/ }).click();
    expect(await scan(), 'tab Usulan agent').toEqual([]);
  });
}
