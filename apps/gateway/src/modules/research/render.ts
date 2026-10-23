import { chromium, type Browser } from 'playwright-core';
import { ResearchError } from './errors.js';
import { assertFetchableUrl, assertPublicHost, type UrlPolicy } from './ssrf.js';

/** Merender halaman yang baru terisi setelah JavaScript berjalan. */
export interface PageRenderer {
  render(url: string, signal?: AbortSignal): Promise<string>;
  close(): Promise<void>;
}

export interface BrowserRendererOptions extends UrlPolicy {
  executablePath: string;
  navigationTimeoutMs?: number;
  /** Jumlah halaman yang dirender bersamaan. */
  concurrency?: number;
  userAgent?: string;
}

const BLOCKED_RESOURCES = new Set(['image', 'media', 'font']);

/**
 * Renderer berbasis Playwright (hanya library; browsernya Chromium/Chrome/Edge yang sudah terpasang di
 * `executablePath`). Setiap permintaan yang dibuat halaman, termasuk subpermintaan dan redirect, diperiksa
 * dengan aturan SSRF yang sama dengan pengambil halaman biasa.
 */
export function createBrowserRenderer(options: BrowserRendererOptions): PageRenderer {
  const {
    executablePath,
    navigationTimeoutMs = 20_000,
    concurrency = 2,
    userAgent = 'Mozilla/5.0 (compatible; PersonalAIOS-Research/1.0)',
  } = options;
  const policy: UrlPolicy = { allowPrivateHosts: options.allowPrivateHosts ?? false };

  let browser: Promise<Browser> | undefined;
  const launch = () =>
    (browser ??= chromium.launch({ executablePath, headless: true }).catch(() => {
      browser = undefined;
      throw new ResearchError(
        'browser_unavailable',
        'Browser untuk halaman JavaScript tidak bisa dijalankan.',
      );
    }));

  let running = 0;
  const waiting: (() => void)[] = [];
  const acquire = async () => {
    if (running >= concurrency) await new Promise<void>((resolve) => waiting.push(resolve));
    running++;
  };
  const release = () => {
    running--;
    waiting.shift()?.();
  };

  return {
    async render(rawUrl, signal) {
      signal?.throwIfAborted();
      const url = assertFetchableUrl(rawUrl, policy);
      await assertPublicHost(url, policy);
      await acquire();
      try {
        signal?.throwIfAborted();
        const context = await (
          await launch()
        ).newContext({
          userAgent,
          acceptDownloads: false,
          serviceWorkers: 'block',
        });
        const abort = () => void context.close().catch(() => undefined);
        signal?.addEventListener('abort', abort, { once: true });
        try {
          signal?.throwIfAborted();
          await context.route('**/*', async (route) => {
            const request = route.request();
            if (BLOCKED_RESOURCES.has(request.resourceType())) return route.abort();
            try {
              await assertPublicHost(assertFetchableUrl(request.url(), policy), policy);
            } catch {
              return route.abort('blockedbyclient');
            }
            return route.continue();
          });
          const page = await context.newPage();
          try {
            await page.goto(url.toString(), {
              waitUntil: 'networkidle',
              timeout: navigationTimeoutMs,
            });
          } catch {
            // networkidle sering tidak tercapai (polling, iklan); isi yang sudah termuat tetap dipakai.
          }
          signal?.throwIfAborted();
          return await page.content();
        } finally {
          signal?.removeEventListener('abort', abort);
          await context.close().catch(() => undefined);
        }
      } catch (err) {
        if (signal?.aborted) throw err;
        if (err instanceof ResearchError) throw err;
        throw new ResearchError('render_failed', 'Halaman JavaScript tidak bisa dirender.');
      } finally {
        release();
      }
    },

    async close() {
      const current = browser;
      browser = undefined;
      if (current) await (await current.catch(() => undefined))?.close().catch(() => undefined);
    },
  };
}
