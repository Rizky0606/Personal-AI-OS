import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIN_TEXT_CHARS, extractReadable, needsJavaScript } from './extract.js';
import { createPageFetcher } from './fetcher.js';
import { createBrowserRenderer, type PageRenderer } from './render.js';

/** Browser yang sudah terpasang: TEST_BROWSER_PATH, atau Chrome/Edge/Chromium di lokasi umum. */
function findBrowser(): string | undefined {
  const candidates = [
    process.env.TEST_BROWSER_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ];
  return candidates.find((p): p is string => !!p && existsSync(p));
}
const browser = findBrowser();

const BODY = Array.from(
  { length: 6 },
  (_, i) =>
    `<p>Paragraf ${i + 1} hanya muncul setelah JavaScript berjalan di halaman aplikasi ini, lengkap dengan angka dan penjelasan yang cukup panjang.</p>`,
).join('');

const SPA = `<!doctype html><html><head><title>Aplikasi</title></head><body>
<div id="root"></div>
<script>window.addEventListener('load', function () { document.getElementById('root').innerHTML = ${JSON.stringify(`<article><h1>Judul dari JavaScript</h1>${BODY}</article>`)}; });</script>
<script>/* skrip kedua */</script></body></html>`;

describe.skipIf(!browser)('renderer Playwright (browser sungguhan)', () => {
  let server: Server;
  let base: string;
  let renderer: PageRenderer;
  const requested: string[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      requested.push(req.url ?? '');
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(req.url === '/spa' ? SPA : '<html><body>biasa</body></html>');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    renderer = createBrowserRenderer({ executablePath: browser!, allowPrivateHosts: true });
  });
  afterAll(async () => {
    await renderer.close();
    server.closeAllConnections();
    server.close();
  });

  it('HTML statis halaman SPA kosong, hasil render memuat teksnya dan lolos ekstraksi', async () => {
    const fetchPage = createPageFetcher({ allowPrivateHosts: true });
    const statik = await fetchPage(`${base}/spa`);
    const before = extractReadable(statik.html, `${base}/spa`);
    expect(before.text.length).toBeLessThan(MIN_TEXT_CHARS);
    expect(needsJavaScript(statik.html, before.text.length)).toBe(true);

    const html = await renderer.render(`${base}/spa`);
    const after = extractReadable(html, `${base}/spa`);
    expect(after.text).toContain('Paragraf 3 hanya muncul setelah JavaScript berjalan');
    expect(after.text.length).toBeGreaterThan(MIN_TEXT_CHARS);
  }, 60_000);

  it('beberapa render bersamaan memakai satu browser dan semuanya selesai', async () => {
    const pages = await Promise.all([1, 2, 3].map(() => renderer.render(`${base}/spa`)));
    expect(pages.every((p) => p.includes('Paragraf 6'))).toBe(true);
  }, 60_000);

  it('pembatalan menghentikan render tanpa menggantung', async () => {
    const abort = new AbortController();
    const pending = renderer.render(`${base}/spa`, abort.signal);
    abort.abort(new Error('dibatalkan'));
    await expect(pending).rejects.toBeDefined();
    // Renderer masih bisa dipakai sesudahnya.
    expect(await renderer.render(`${base}/spa`)).toContain('Paragraf 1');
  }, 60_000);
});

describe('renderer: keamanan (tanpa browser)', () => {
  it('menolak URL privat sebelum browser dijalankan; executablePath palsu tidak pernah dipakai', async () => {
    const renderer = createBrowserRenderer({ executablePath: '/tidak/ada/chromium' });
    for (const url of [
      'http://127.0.0.1:20128/v1/models',
      'http://localhost:8642/',
      'http://169.254.169.254/',
      'file:///etc/passwd',
    ]) {
      await expect(renderer.render(url), url).rejects.toMatchObject({ code: 'url_blocked' });
    }
    await renderer.close();
  });

  it('browser yang tidak bisa dijalankan menjadi error berkode, bukan crash', async () => {
    const renderer = createBrowserRenderer({
      executablePath: '/tidak/ada/chromium',
      allowPrivateHosts: true,
    });
    await expect(renderer.render('http://127.0.0.1:9/')).rejects.toMatchObject({
      code: expect.stringMatching(/render_failed|browser_unavailable/) as string,
    });
    await renderer.close();
  });
});
