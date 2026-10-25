import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, login, prepare, test } from './fixtures';

/**
 * Review desain otomatis (Fase 24): aksesibilitas (axe, WCAG 2.1 AA: kontras, label, nama tombol, struktur) di
 * setiap layar utama, tema terang dan gelap. Temuan apa pun menggagalkan tes.
 */
const SCREENS: { name: string; hash: string }[] = [
  { name: 'Chat', hash: '#/' },
  { name: 'Project', hash: '#/projects' },
  { name: 'Kanban', hash: '#/kanban' },
  { name: 'Jadwal', hash: '#/schedules' },
  { name: 'Riset', hash: '#/research' },
  { name: 'Ruang', hash: '#/spaces' },
  { name: 'Pengaturan', hash: '#/settings' },
  { name: 'Kuota', hash: '#/quota' },
  { name: 'Pembanding model', hash: '#/compare' },
  { name: 'Status', hash: '#/status' },
];

async function violations(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return result.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    nodes: v.nodes
      .slice(0, 3)
      .map((n) => `${n.target.join(' ')} :: ${n.failureSummary?.split('\n')[1] ?? ''}`),
  }));
}

for (const theme of ['light', 'dark'] as const) {
  test(`aksesibilitas tema ${theme}: login dan semua layar utama bebas pelanggaran WCAG AA`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme });
    await prepare(page);
    await page.goto('/');
    const found: Record<string, unknown> = {};

    const loginIssues = await violations(page);
    if (loginIssues.length > 0) found.Login = loginIssues;

    await login(page);
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);

    for (const screen of SCREENS) {
      await page.goto(`/${screen.hash}`);
      await page.getByRole('main').waitFor();
      // Beri waktu data awal (daftar kosong, status) selesai dimuat.
      await page.waitForTimeout(700);
      const issues = await violations(page);
      if (issues.length > 0) found[screen.name] = issues;
    }

    await page.keyboard.press('Control+k');
    await page.getByRole('combobox', { name: 'Cari atau jalankan perintah' }).waitFor();
    const palette = await violations(page);
    if (palette.length > 0) found['Palet perintah'] = palette;

    expect(found, JSON.stringify(found, null, 2)).toEqual({});
  });
}
