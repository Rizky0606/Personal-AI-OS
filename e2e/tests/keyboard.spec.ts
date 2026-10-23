import { control, expect, login, prepare, test } from './fixtures';

test('alur utama hanya dengan keyboard: palet, pindah layar, kirim pesan, dan fokus selalu terlihat', async ({
  page,
}) => {
  await prepare(page);
  const config = await control.config();
  await login(page);

  // Chat baru lewat shortcut; composer langsung siap diketik, Enter mengirim.
  await page.keyboard.press('Control+n');
  await page.keyboard.type('Halo dari keyboard saja');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main').getByText(config.hermesAnswer)).toBeVisible();

  // Palet perintah: cari lalu Enter membuka layar tanpa mouse.
  await page.keyboard.press('Control+k');
  await page.keyboard.type('kuota');
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('main').getByRole('heading', { name: 'Kuota' }).first(),
  ).toBeVisible();

  // Ctrl+1..6 berpindah layar.
  await page.keyboard.press('Control+4');
  await expect(page.getByRole('heading', { name: 'Jadwal', level: 1 })).toBeVisible();
  await page.keyboard.press('Control+1');
  await expect(page.getByRole('textbox', { name: 'Pesan' })).toBeVisible();

  // Setiap Tab memindahkan fokus ke elemen dengan cincin fokus yang terlihat (2px).
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  const seen = new Set<string>();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    const style = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const css = getComputedStyle(el);
      return {
        label: el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 30) ?? el.tagName,
        outlineStyle: css.outlineStyle,
        outlineWidth: parseFloat(css.outlineWidth),
        boxShadow: css.boxShadow,
      };
    });
    if (!style) continue;
    seen.add(style.label);
    const visible =
      (style.outlineStyle !== 'none' && style.outlineWidth >= 2) || style.boxShadow !== 'none';
    expect(visible, `fokus tidak terlihat pada "${style.label}"`).toBe(true);
  }
  expect(seen.size).toBeGreaterThan(5);
});
