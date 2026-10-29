import type { Page } from '@playwright/test';
import { expect, login, prepare, test } from './fixtures';

/** Menghitung pemanggilan document.startViewTransition (dan melepasnya untuk uji fallback). */
async function trackViewTransitions(page: Page, { remove = false } = {}) {
  await page.addInitScript((drop) => {
    const w = window as unknown as { __vt: number };
    w.__vt = 0;
    const original = document.startViewTransition?.bind(document);
    if (drop) {
      Object.defineProperty(document, 'startViewTransition', {
        value: undefined,
        configurable: true,
      });
      return;
    }
    if (!original) return;
    document.startViewTransition = ((cb: never) => {
      w.__vt++;
      return original(cb);
    }) as typeof document.startViewTransition;
  }, remove);
}
const transitions = (page: Page) =>
  page.evaluate(() => (window as unknown as { __vt: number }).__vt);

const box = async (page: Page, selector: string) => {
  const b = await page.locator(selector).first().boundingBox();
  if (!b) throw new Error(`tidak terlihat: ${selector}`);
  return b;
};

test('perpindahan layar memakai View Transitions: isi berganti, pelat sidebar meluncur ke item aktif', async ({
  page,
}) => {
  await trackViewTransitions(page);
  await prepare(page);
  await login(page);
  const supported = await page.evaluate(() => typeof document.startViewTransition === 'function');
  expect(supported, 'peramban uji harus mendukung View Transitions').toBe(true);

  const before = await transitions(page);
  const plateBefore = await page.locator('[data-plate="active"]').first().getAttribute('style');

  await page.keyboard.press('Control+3');
  await expect(page.getByRole('heading', { name: 'Kanban', level: 1 })).toBeVisible();

  expect(await transitions(page)).toBeGreaterThan(before);
  // Pelat berpindah dan akhirnya menutupi item aktif (toleransi 2 px setelah transisi pegas selesai).
  await expect(page.getByRole('link', { name: 'Kanban', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect
    .poll(
      async () =>
        (await page.locator('[data-plate="active"]').first().getAttribute('style')) !== plateBefore,
    )
    .toBe(true);
  await expect
    .poll(async () => {
      const plate = await box(page, '[data-plate="active"]');
      const item = await box(page, 'nav a[aria-current="page"]');
      return Math.abs(plate.y - item.y) + Math.abs(plate.height - item.height);
    })
    .toBeLessThan(3);

  // Lewat klik tautan juga memakai transisi.
  const afterKeyboard = await transitions(page);
  await page.getByRole('link', { name: 'Jadwal', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Jadwal', level: 1 })).toBeVisible();
  expect(await transitions(page)).toBeGreaterThan(afterKeyboard);
});

test('tanpa dukungan View Transitions: perpindahan tetap bekerja tanpa animasi', async ({
  page,
}) => {
  await trackViewTransitions(page, { remove: true });
  await prepare(page);
  await login(page);
  expect(await page.evaluate(() => typeof document.startViewTransition)).toBe('undefined');

  await page.keyboard.press('Control+4');
  await expect(page.getByRole('heading', { name: 'Jadwal', level: 1 })).toBeVisible();
  await page.keyboard.press('Control+1');
  await expect(page.getByRole('textbox', { name: 'Pesan' })).toBeVisible();
});

test('prefers-reduced-motion: layar tetap berpindah dan pelat langsung di tempatnya (tanpa transisi)', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await prepare(page);
  await login(page);

  await page.keyboard.press('Control+5');
  await expect(page.getByRole('heading', { name: 'Riset', level: 1 })).toBeVisible();
  const duration = await page
    .locator('[data-plate="active"]')
    .first()
    .evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(parseFloat(duration.split(',')[0] ?? '0')).toBeLessThanOrEqual(0.001);
});

test('palet perintah: Ctrl+K, panah, Enter membuka layar; Esc menutup dan fokus kembali; fokus terkunci di dalam; pintasan terlihat', async ({
  page,
}) => {
  await prepare(page);
  await login(page);
  const opener = page.getByRole('textbox', { name: 'Pesan' });
  await opener.focus();

  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Palet perintah' });
  const input = dialog.getByRole('combobox', { name: 'Cari atau jalankan perintah' });
  await expect(input).toBeFocused();

  // Pintasan terlihat di baris navigasi (satu sumber dengan Ctrl+1..6).
  await expect(dialog.getByRole('option', { name: /Kanban.*Ctrl\+3/ })).toBeVisible();

  // Fokus terkunci: Tab berkali-kali tidak keluar dari dialog.
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(
      true,
    );
  }

  await input.focus();
  await page.keyboard.type('jadwal');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Jadwal', level: 1 })).toBeVisible();
  await expect(dialog).toBeHidden();

  // Esc menutup dan mengembalikan fokus ke elemen sebelumnya.
  await page.keyboard.press('Control+1');
  const composer = page.getByRole('textbox', { name: 'Pesan' });
  await composer.focus();
  await page.keyboard.press('Control+k');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(composer).toBeFocused();
});

test('sidebar ringkas (Ctrl+B): 64 px, hanya ikon dengan tooltip; lebar kembali saat dibuka', async ({
  page,
}) => {
  await prepare(page);
  await login(page);
  const sidebar = page.getByRole('complementary', { name: 'Daftar' });
  await expect.poll(async () => (await sidebar.boundingBox())?.width).toBe(232);

  await page.keyboard.press('Control+b');
  await expect.poll(async () => Math.round((await sidebar.boundingBox())?.width ?? 0)).toBe(64);
  await page.getByRole('link', { name: 'Kanban', exact: true }).hover();
  await expect(page.getByRole('tooltip')).toHaveText('Kanban');

  await page.keyboard.press('Control+b');
  await expect.poll(async () => Math.round((await sidebar.boundingBox())?.width ?? 0)).toBe(232);
});

test('panel kanan: Ctrl+J melebar mulus ke lebar tersimpan dan tombol toggle di topbar sinkron', async ({
  page,
}) => {
  await prepare(page);
  await login(page);
  const panel = page.getByRole('complementary', { name: 'Panel kanan' });
  await expect(panel).toBeHidden();

  await page.keyboard.press('Control+j');
  await expect.poll(async () => Math.round((await panel.boundingBox())?.width ?? 0)).toBe(420);
  await expect(page.getByRole('button', { name: 'Panel kanan' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // Tab panel: yang aktif berlabel, ada 6 tab.
  await expect(page.getByRole('tab')).toHaveCount(6);

  await page.keyboard.press('Control+j');
  await expect(panel).toBeHidden();
});

test('luring: banner informasi muncul di shell dan hilang saat kembali online', async ({
  page,
  context,
}) => {
  await prepare(page);
  await login(page);
  await expect(
    page.getByRole('main').getByText('Perangkat sedang luring', { exact: false }),
  ).toBeHidden();

  await context.setOffline(true);
  await expect(
    page.getByRole('main').getByText('Perangkat sedang luring', { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole('main').getByRole('status').first()).toBeVisible();

  await context.setOffline(false);
  await expect(
    page.getByRole('main').getByText('Perangkat sedang luring', { exact: false }),
  ).toBeHidden();
});
