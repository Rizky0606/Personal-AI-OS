import { existsSync } from 'node:fs';
import { LAYOUT_SCRIPT, describeLayout, type LayoutReport } from './layout.js';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';

export class BrowserError extends Error {
  constructor(
    readonly code:
      'browser_not_found' | 'browser_launch_failed' | 'preview_not_running' | 'bad_request',
    message: string,
  ) {
    super(message);
    this.name = 'BrowserError';
  }
}

/** Browser Chromium yang sudah ada di PC (Edge ikut Windows 10/11); tidak mengunduh apa pun. */
export function findBrowser(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const candidates = [
    env.AIOS_BROWSER_PATH,
    ...['ProgramFiles(x86)', 'ProgramFiles', 'LOCALAPPDATA'].flatMap((base) => {
      const root = env[base];
      return root
        ? [
            `${root}\\Microsoft\\Edge\\Application\\msedge.exe`,
            `${root}\\Google\\Chrome\\Application\\chrome.exe`,
          ]
        : [];
    }),
    '/usr/bin/microsoft-edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ];
  return candidates.find((p): p is string => typeof p === 'string' && p !== '' && existsSync(p));
}

export interface ConsoleEntry {
  level: string;
  text: string;
}

export interface Viewport {
  width: number;
  height: number;
}

const DEFAULT_VIEWPORT: Viewport = { width: 1280, height: 800 };
const MAX_ENTRIES = 200;
const MAX_FULLPAGE_HEIGHT = 4000;
const ACTION_TIMEOUT_MS = 8000;

const clampSize = (value: number | undefined, fallback: number, min: number, max: number) =>
  value === undefined || !Number.isFinite(value)
    ? fallback
    : Math.min(max, Math.max(min, Math.round(value)));

/** Satu Chromium bersama untuk semua sesi; dibuka saat pertama dipakai dan ditutup bersama worker. */
export class BrowserHost {
  private browser: Promise<Browser> | undefined;

  constructor(private readonly executablePath: string | undefined = findBrowser()) {}

  get available(): boolean {
    return this.executablePath !== undefined;
  }

  private launch(): Promise<Browser> {
    if (!this.executablePath) {
      return Promise.reject(
        new BrowserError(
          'browser_not_found',
          'Tidak ada Edge atau Chrome di PC ini. Pasang salah satunya atau isi AIOS_BROWSER_PATH.',
        ),
      );
    }
    this.browser ??= chromium
      .launch({ executablePath: this.executablePath, headless: true })
      .catch((error: unknown) => {
        this.browser = undefined;
        throw new BrowserError(
          'browser_launch_failed',
          `Browser gagal dijalankan: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`,
        );
      });
    return this.browser;
  }

  async newContext(): Promise<BrowserContext> {
    const browser = await this.launch();
    return browser.newContext({ viewport: DEFAULT_VIEWPORT, deviceScaleFactor: 1 });
  }

  async close(): Promise<void> {
    const pending = this.browser;
    this.browser = undefined;
    if (pending) await (await pending.catch(() => undefined))?.close().catch(() => undefined);
  }
}

/**
 * Sesi browser milik satu run: satu halaman yang hanya boleh membuka preview run itu (origin yang sama).
 * Merekam console, error halaman, dan request gagal untuk dibaca agent.
 */
export class BrowserSession {
  private context: BrowserContext | undefined;
  private page: Page | undefined;
  private readonly entries: ConsoleEntry[] = [];
  private readonly failures: string[] = [];
  private viewport: Viewport = DEFAULT_VIEWPORT;

  constructor(
    private readonly host: BrowserHost,
    /** URL dev server run ini; memulainya bila belum berjalan. Menolak (BrowserError) bila tidak bisa. */
    private readonly previewUrl: () => Promise<string>,
  ) {}

  private async ensurePage(path?: string): Promise<Page> {
    const base = await this.previewUrl();
    if (!this.page) {
      this.context = await this.host.newContext();
      const page = await this.context.newPage();
      page.setDefaultTimeout(ACTION_TIMEOUT_MS);
      page.on('console', (m) => this.record(m.type(), m.text()));
      page.on('pageerror', (e) => this.record('error', e.message));
      page.on('requestfailed', (r) =>
        this.fail(`${r.method()} ${r.url()} gagal: ${r.failure()?.errorText ?? 'tidak diketahui'}`),
      );
      page.on('response', (r) => {
        if (r.status() >= 400) this.fail(`${r.request().method()} ${r.url()} -> ${r.status()}`);
      });
      this.page = page;
    }
    const target = new URL(path ?? '/', base);
    if (target.origin !== new URL(base).origin) {
      throw new BrowserError('bad_request', 'Hanya halaman preview project ini yang boleh dibuka.');
    }
    const current = this.page.url();
    if (
      path !== undefined ||
      current === 'about:blank' ||
      !current.startsWith(new URL(base).origin)
    ) {
      await this.page.goto(target.toString(), { waitUntil: 'load' }).catch((error: unknown) => {
        this.fail(
          `Membuka ${target.pathname} gagal: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`,
        );
      });
    }
    return this.page;
  }

  private record(level: string, text: string): void {
    this.entries.push({ level, text: text.slice(0, 1000) });
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();
  }

  private fail(text: string): void {
    this.failures.push(text.slice(0, 500));
    if (this.failures.length > MAX_ENTRIES) this.failures.shift();
  }

  private async resize(page: Page, size: { width?: number; height?: number }): Promise<void> {
    if (size.width === undefined && size.height === undefined) return;
    this.viewport = {
      width: clampSize(size.width, this.viewport.width, 200, 2560),
      height: clampSize(size.height, this.viewport.height, 200, 1600),
    };
    await page.setViewportSize(this.viewport);
  }

  private async settle(page: Page): Promise<void> {
    await page.waitForLoadState('networkidle', { timeout: 2500 }).catch(() => undefined);
  }

  /** Tangkapan halaman, atau satu elemen bila `selector` diisi. Ukuran viewport bertahan untuk panggilan berikutnya. */
  async screenshot(options: {
    selector?: string | undefined;
    path?: string | undefined;
    width?: number | undefined;
    height?: number | undefined;
    fullPage?: boolean | undefined;
    /** Muat ulang halaman dulu (setelah kode diubah). */
    reload?: boolean | undefined;
  }): Promise<{ png: Buffer; url: string; viewport: Viewport; layout: string }> {
    const page = await this.ensurePage(options.path);
    if (options.reload && options.path === undefined) {
      await page.reload({ waitUntil: 'load' }).catch(() => undefined);
    }
    await this.resize(page, options);
    await this.settle(page);
    let png: Buffer;
    try {
      if (options.selector) {
        png = await page
          .locator(options.selector)
          .first()
          .screenshot({ timeout: ACTION_TIMEOUT_MS });
      } else if (options.fullPage) {
        const height = await page.evaluate(
          'Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)',
        );
        png = await page.screenshot({
          clip: {
            x: 0,
            y: 0,
            width: this.viewport.width,
            height: Math.min(Number(height) || this.viewport.height, MAX_FULLPAGE_HEIGHT),
          },
          fullPage: true,
        });
      } else {
        png = await page.screenshot();
      }
    } catch (error) {
      throw new BrowserError(
        'bad_request',
        `Screenshot gagal: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`,
      );
    }
    const layout = await page
      .evaluate<LayoutReport>(LAYOUT_SCRIPT)
      .then(describeLayout, () => 'Tata letak: tidak bisa diperiksa.');
    return { png, url: page.url(), viewport: this.viewport, layout };
  }

  async click(selector: string): Promise<{ url: string }> {
    const page = await this.ensurePage();
    try {
      await page.locator(selector).first().click({ timeout: ACTION_TIMEOUT_MS });
    } catch (error) {
      throw new BrowserError(
        'bad_request',
        `Klik gagal: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`,
      );
    }
    await this.settle(page);
    return { url: page.url() };
  }

  async fill(selector: string, value: string): Promise<{ url: string }> {
    const page = await this.ensurePage();
    try {
      await page.locator(selector).first().fill(value, { timeout: ACTION_TIMEOUT_MS });
    } catch (error) {
      throw new BrowserError(
        'bad_request',
        `Isi gagal: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`,
      );
    }
    await this.settle(page);
    return { url: page.url() };
  }

  /** Console, error halaman, dan request gagal sejak terakhir dibaca. */
  readConsole(clear = true): { console: ConsoleEntry[]; failedRequests: string[] } {
    const result = { console: [...this.entries], failedRequests: [...this.failures] };
    if (clear) {
      this.entries.length = 0;
      this.failures.length = 0;
    }
    return result;
  }

  async close(): Promise<void> {
    const context = this.context;
    this.context = undefined;
    this.page = undefined;
    await context?.close().catch(() => undefined);
  }
}
