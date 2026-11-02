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
  // Tab panel: yang aktif berlabel, ada 7 tab (Progres pertama).
  await expect(page.getByRole('tab')).toHaveCount(7);

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

const GAP = 8;
const rect = async (page: Page, selector: string) => {
  const b = await page.locator(selector).first().boundingBox();
  if (!b) throw new Error('tidak terlihat: ' + selector);
  return { x: b.x, y: b.y, right: b.x + b.width, bottom: b.y + b.height, width: b.width };
};

test('pulau: sidebar, area utama, dan panel kanan berjarak 8 px dari tepi jendela dan satu sama lain', async ({
  page,
}) => {
  await prepare(page);
  await login(page);
  const viewport = page.viewportSize()!;
  const sidebar = await rect(page, 'aside[aria-label="Daftar"]');
  const main = await rect(page, 'main');

  expect(sidebar.x).toBe(GAP);
  expect(sidebar.y).toBe(GAP);
  expect(sidebar.bottom).toBe(viewport.height - GAP);
  expect(main.x).toBe(sidebar.right + GAP);
  expect(main.y).toBe(GAP);
  expect(main.bottom).toBe(viewport.height - GAP);
  expect(main.right).toBe(viewport.width - GAP);

  await page.keyboard.press('Control+j');
  await expect
    .poll(async () => Math.round((await rect(page, 'aside[aria-label="Panel kanan"]')).width))
    .toBe(420);
  // Jarak main-panel tepat 8 px setelah animasi selesai.
  await expect
    .poll(async () => {
      const gap =
        (await rect(page, 'aside[aria-label="Panel kanan"]')).x - (await rect(page, 'main')).right;
      return Math.round(gap);
    })
    .toBe(GAP);
  const panel = await rect(page, 'aside[aria-label="Panel kanan"]');
  const narrowed = await rect(page, 'main');
  expect(panel.right).toBe(viewport.width - GAP);
  expect(panel.y).toBe(GAP);
  expect(panel.bottom).toBe(viewport.height - GAP);
  // Topbar berada di dalam pulau utama.
  const topbar = await rect(page, 'main header');
  expect(topbar.x).toBeGreaterThanOrEqual(narrowed.x);
  expect(topbar.right).toBeLessThanOrEqual(narrowed.right);
});

test('satu judul per layar: tiap bagian punya tepat satu judul, tanpa judul kedua dengan teks sama', async ({
  page,
}) => {
  await prepare(page);
  await login(page);
  const main = page.getByRole('main');
  const assertSingleTitle = async () => {
    const h1 = main.getByRole('heading', { level: 1 });
    await expect(h1).toHaveCount(1);
    const title = (await h1.textContent())!.trim();
    await expect(main.getByRole('heading', { name: title, exact: true })).toHaveCount(1);
  };

  for (const key of ['1', '2', '3', '4', '5', '6']) {
    await page.keyboard.press('Control+' + key);
    await assertSingleTitle();
  }
  await page.getByRole('link', { name: 'Ruang', exact: true }).click();
  await assertSingleTitle();
});

test('sidebar: pelat aktif MELUNCUR antar item (bukan melompat) dan pelat hover menyusul kursor', async ({
  page,
}) => {
  await prepare(page);
  await login(page);
  await expect(page.locator('[data-plate="active"]').first()).toHaveAttribute(
    'data-visible',
    'true',
  );

  // Sampel posisi pelat tiap frame selama perpindahan Chat -> Jadwal.
  await page.evaluate(() => {
    const plate = document.querySelector('[data-plate="active"]')!;
    const w = window as unknown as { __plateY: number[] };
    w.__plateY = [];
    const tick = () => {
      w.__plateY.push(new DOMMatrixReadOnly(getComputedStyle(plate).transform).m42);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.mouse.move(700, 450);
  await page.keyboard.press('Control+4');
  await page.waitForTimeout(900);
  const samples = await page.evaluate(() => (window as unknown as { __plateY: number[] }).__plateY);
  const start = samples[0]!;
  const end = samples[samples.length - 1]!;
  const between = new Set(
    samples.filter((y) => y > Math.min(start, end) + 1 && y < Math.max(start, end) - 1),
  );
  expect(end).toBeGreaterThan(start);
  expect(between.size, 'pelat harus melewati posisi antara').toBeGreaterThanOrEqual(3);

  // Link aktif tidak punya latar sendiri: yang terlihat hanya pelat.
  const bg = await page
    .locator('nav a[aria-current="page"]')
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe('rgba(0, 0, 0, 0)');

  // Hover glide: pelat hover mengikuti item yang disorot.
  const kanban = page.getByRole('link', { name: 'Kanban', exact: true });
  await kanban.hover();
  const hoverPlate = page.locator('[data-plate="hover"]').first();
  await expect(hoverPlate).toHaveAttribute('data-visible', 'true');
  await expect
    .poll(async () => {
      const p = (await hoverPlate.boundingBox())!;
      const k = (await kanban.boundingBox())!;
      return Math.abs(p.y - k.y) + Math.abs(p.height - k.height);
    })
    .toBeLessThan(3);
});

test('panel kanan: buka dan tutup menggeser area utama bertahap, tidak melompat', async ({
  page,
}) => {
  await prepare(page);
  await login(page);
  const track = () =>
    page.evaluate(() => {
      const main = document.querySelector('main')!;
      const w = window as unknown as { __mainW: number[] };
      w.__mainW = [];
      const tick = () => {
        w.__mainW.push(main.getBoundingClientRect().width);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  const read = () => page.evaluate(() => (window as unknown as { __mainW: number[] }).__mainW);
  const assertSmooth = (samples: number[]) => {
    const total = Math.abs(samples[samples.length - 1]! - samples[0]!);
    expect(total).toBeGreaterThan(300);
    let maxStep = 0;
    for (let i = 1; i < samples.length; i++)
      maxStep = Math.max(maxStep, Math.abs(samples[i]! - samples[i - 1]!));
    // Satu loncatan akan setara seluruh perubahan; animasi 240 ms terbagi ke banyak frame.
    expect(maxStep).toBeLessThan(total / 3);
    expect(new Set(samples.map((x) => Math.round(x))).size).toBeGreaterThanOrEqual(4);
  };

  await track();
  await page.keyboard.press('Control+j');
  await page.waitForTimeout(700);
  assertSmooth(await read());

  await track();
  await page.keyboard.press('Control+j');
  await page.waitForTimeout(700);
  assertSmooth(await read());
});

test('lebar 1024: tanpa gulir mendatar, pulau tidak saling menimpa, judul tidak terpotong; sidebar bisa diringkas', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await prepare(page);
  await login(page);

  const overlapFree = async () => {
    const boxes = [await rect(page, 'aside[aria-label="Daftar"]'), await rect(page, 'main')];
    if (await page.getByRole('complementary', { name: 'Panel kanan' }).isVisible())
      boxes.push(await rect(page, 'aside[aria-label="Panel kanan"]'));
    for (let i = 1; i < boxes.length; i++)
      expect(boxes[i]!.x).toBeGreaterThanOrEqual(boxes[i - 1]!.right);
    expect(boxes[boxes.length - 1]!.right).toBeLessThanOrEqual(1024 - GAP);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      1024,
    );
  };
  const clipped = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('main header h1, main header [data-chip]'))
        .filter((el) => el.scrollWidth > el.clientWidth + 1)
        .map((el) => el.textContent),
    );

  await overlapFree();
  expect(await clipped()).toEqual([]);

  // Panel terbuka di 1024: sidebar diringkas supaya area utama tetap lega.
  await page.keyboard.press('Control+j');
  await page.keyboard.press('Control+b');
  await expect
    .poll(async () => Math.round((await rect(page, 'aside[aria-label="Daftar"]')).width))
    .toBe(64);
  await expect
    .poll(async () => Math.round((await rect(page, 'aside[aria-label="Panel kanan"]')).width))
    .toBe(420);
  await overlapFree();
  expect(await clipped()).toEqual([]);

  // Layar lain di lebar yang sama.
  for (const key of ['3', '6']) {
    await page.keyboard.press('Control+' + key);
    await overlapFree();
    expect(await clipped()).toEqual([]);
  }
});
