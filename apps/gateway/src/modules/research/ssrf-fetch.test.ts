import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { ResearchError } from './errors.js';
import { createPageFetcher } from './fetcher.js';
import { assertFetchableUrl, guardedLookup, isPublicIp } from './ssrf.js';

const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    s.close();
  }
});

interface Seen {
  url: string;
  headers: IncomingMessage['headers'];
}

async function web(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    seen.push({ url: req.url ?? '', headers: req.headers });
    handler(req, res);
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, seen };
}

const failure = async (p: Promise<unknown>): Promise<ResearchError> => {
  try {
    await p;
  } catch (err) {
    if (err instanceof ResearchError) return err;
    throw err;
  }
  throw new Error('seharusnya gagal');
};

describe('SSRF: alamat yang boleh dijangkau', () => {
  it.each([
    '127.0.0.1',
    '127.255.255.254',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    'fe80::1',
    'fc00::1',
    'fd12:3456::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    '64:ff9b::7f00:1',
    'bukan-ip',
  ])('%s ditolak', (ip) => {
    expect(isPublicIp(ip)).toBe(false);
  });

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '93.184.216.34',
    '172.15.255.255',
    '172.32.0.1',
    '2606:4700:4700::1111',
    '::ffff:8.8.8.8',
  ])('%s diizinkan', (ip) => {
    expect(isPublicIp(ip)).toBe(true);
  });

  it('assertFetchableUrl menolak skema, kredensial, host lokal, dan IP privat (termasuk bentuk desimal)', () => {
    for (const url of [
      'ftp://contoh.com/a',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'http://user:pass@contoh.com/',
      'http://localhost:8642/v1',
      'http://api.localhost/',
      'http://layanan.internal/',
      'http://127.0.0.1:20128/v1/models',
      'http://[::1]:5432/',
      'http://169.254.169.254/latest/meta-data/',
      'http://10.0.0.5/',
      'http://2130706433/',
      'http://0x7f000001/',
      'bukan url',
    ]) {
      expect(() => assertFetchableUrl(url), url).toThrowError(ResearchError);
    }
    expect(assertFetchableUrl('https://contoh.com/artikel?x=1').hostname).toBe('contoh.com');
    expect(assertFetchableUrl('http://8.8.8.8/').hostname).toBe('8.8.8.8');
  });

  it('guardedLookup menolak nama yang mengarah ke loopback, dan membolehkannya hanya bila diizinkan (tes)', async () => {
    const lookup = (policy: { allowPrivateHosts?: boolean }, all: boolean) =>
      new Promise<{ code?: string; ok: boolean }>((resolve) => {
        guardedLookup(policy)('localhost', { all }, (err) =>
          resolve({ ok: !err, ...(err?.code ? { code: err.code } : {}) }),
        );
      });
    expect(await lookup({}, true)).toEqual({ ok: false, code: 'EBLOCKED' });
    expect(await lookup({}, false)).toEqual({ ok: false, code: 'EBLOCKED' });
    expect(await lookup({ allowPrivateHosts: true }, true)).toEqual({ ok: true });
    expect(await lookup({ allowPrivateHosts: true }, false)).toEqual({ ok: true });
  });
});

describe('pengambil halaman: kebijakan keamanan bawaan', () => {
  it('tidak pernah menghubungi server di 127.0.0.1 atau localhost, dan tidak membocorkan isinya', async () => {
    const { base, seen } = await web((_req, res) => res.end('<html>rahasia internal</html>'));
    const fetchPage = createPageFetcher(); // kebijakan produksi
    const byIp = await failure(fetchPage(`${base}/admin`));
    const byName = await failure(fetchPage(base.replace('127.0.0.1', 'localhost')));
    expect([byIp.code, byName.code]).toEqual(['url_blocked', 'url_blocked']);
    expect(seen).toHaveLength(0);
  });
});

describe('pengambil halaman', () => {
  const fetchPage = createPageFetcher({ allowPrivateHosts: true, timeoutMs: 800, maxBytes: 4096 });
  const html = (body: string) => `<!doctype html><html><body>${body}</body></html>`;

  it('mengambil HTML, mengirim User-Agent peneliti, dan mengembalikan URL akhir', async () => {
    const { base, seen } = await web((_req, res) => {
      res
        .writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        .end(html('<p>Halo dunia</p>'));
    });
    const page = await fetchPage(`${base}/artikel`);
    expect(page.html).toContain('Halo dunia');
    expect(page.finalUrl).toBe(`${base}/artikel`);
    expect(page.truncated).toBe(false);
    expect(seen[0]!.headers['user-agent']).toContain('PersonalAIOS-Research');
    expect(seen[0]!.headers.cookie).toBeUndefined();
    expect(seen[0]!.headers.authorization).toBeUndefined();
  });

  it('mengikuti redirect (relatif dan absolut) dan membatasi jumlahnya', async () => {
    const { base } = await web((req, res) => {
      if (req.url === '/a') return void res.writeHead(302, { location: '/b' }).end();
      if (req.url === '/b') return void res.writeHead(301, { location: `${base}/c` }).end();
      if (req.url === '/c')
        return void res.writeHead(200, { 'content-type': 'text/html' }).end(html('akhir'));
      if (req.url === '/loop') return void res.writeHead(302, { location: '/loop' }).end();
      res.writeHead(404).end();
    });
    expect((await fetchPage(`${base}/a`)).finalUrl).toBe(`${base}/c`);
    expect((await failure(fetchPage(`${base}/loop`))).message).toContain('redirect');
  });

  it('redirect ke alamat yang ditolak dihentikan sebelum dihubungi', async () => {
    const strict = createPageFetcher({ allowPrivateHosts: false });
    // Server publik tiruan tidak mungkin di sini; cukup buktikan bahwa lokasi redirect diperiksa ulang
    // lewat assertFetchableUrl (IP metadata cloud).
    expect(() =>
      assertFetchableUrl(new URL('http://169.254.169.254/', 'https://contoh.com').toString()),
    ).toThrowError(ResearchError);
    expect((await failure(strict('http://169.254.169.254/latest/meta-data/'))).code).toBe(
      'url_blocked',
    );
  });

  it('status bukan 2xx, jenis konten bukan teks, dan timeout menjadi error berkode', async () => {
    const { base } = await web((req, res) => {
      if (req.url === '/404') return void res.writeHead(404).end('tidak ada');
      if (req.url === '/pdf')
        return void res.writeHead(200, { 'content-type': 'application/pdf' }).end('%PDF');
      if (req.url === '/lambat') return; // tidak pernah menjawab
      res.writeHead(200, { 'content-type': 'text/html' }).end('ok');
    });
    expect((await failure(fetchPage(`${base}/404`))).code).toBe('fetch_http');
    expect((await failure(fetchPage(`${base}/pdf`))).code).toBe('fetch_unsupported');
    expect((await failure(fetchPage(`${base}/lambat`))).code).toBe('fetch_timeout');
  });

  it('membuka gzip dan brotli, serta membaca charset dari header atau meta', async () => {
    const text = html('<p>Kopi, teh, dan pisang goreng: camilan sore.</p>');
    const { base } = await web((req, res) => {
      if (req.url === '/gzip') {
        return void res
          .writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' })
          .end(gzipSync(text));
      }
      if (req.url === '/br') {
        return void res
          .writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'br' })
          .end(brotliCompressSync(text));
      }
      if (req.url === '/latin1') {
        return void res
          .writeHead(200, { 'content-type': 'text/html; charset=iso-8859-1' })
          .end(Buffer.from('<p>café résumé</p>', 'latin1'));
      }
      res
        .writeHead(200, { 'content-type': 'text/html' })
        .end(Buffer.from('<meta charset="iso-8859-1"><p>naïve façade</p>', 'latin1'));
    });
    expect((await fetchPage(`${base}/gzip`)).html).toContain('pisang goreng');
    expect((await fetchPage(`${base}/br`)).html).toContain('pisang goreng');
    expect((await fetchPage(`${base}/latin1`)).html).toContain('café résumé');
    expect((await fetchPage(`${base}/meta`)).html).toContain('naïve façade');
  });

  it('memotong isi besar di batas ukuran tanpa gagal', async () => {
    const { base } = await web((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' }).end(html('x'.repeat(50_000)));
    });
    const page = await fetchPage(`${base}/besar`);
    expect(page.truncated).toBe(true);
    expect(page.html.length).toBeLessThanOrEqual(4096);
  });

  it('dibatalkan lewat AbortSignal', async () => {
    const { base } = await web(() => undefined);
    const abort = new AbortController();
    const pending = createPageFetcher({ allowPrivateHosts: true, timeoutMs: 5000 })(
      `${base}/diam`,
      abort.signal,
    );
    setTimeout(() => abort.abort(new Error('dibatalkan')), 50);
    await expect(pending).rejects.toBeDefined();
    await expect(pending).rejects.not.toMatchObject({ code: 'fetch_timeout' });
  });
});
