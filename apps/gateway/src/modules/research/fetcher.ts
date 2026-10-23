import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { ResearchError } from './errors.js';
import { assertFetchableUrl, guardedLookup, type UrlPolicy } from './ssrf.js';

export interface FetchedPage {
  /** URL akhir setelah redirect. */
  finalUrl: string;
  contentType: string;
  html: string;
  /** Isi dipotong di batas ukuran. */
  truncated: boolean;
}

export type PageFetcher = (url: string, signal?: AbortSignal) => Promise<FetchedPage>;

export interface PageFetcherOptions extends UrlPolicy {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  userAgent?: string;
}

const DEFAULTS = {
  timeoutMs: 15_000,
  maxBytes: 2 * 1024 * 1024,
  maxRedirects: 5,
  userAgent: 'Mozilla/5.0 (compatible; PersonalAIOS-Research/1.0)',
};

const TEXTUAL = /^(text\/html|application\/xhtml\+xml|text\/plain)\b/i;

function decodeBody(buffer: Buffer, contentType: string): string {
  const header = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  const sniffed = /<meta[^>]+charset=["']?([\w-]+)/i.exec(
    buffer.subarray(0, 2048).toString('latin1'),
  )?.[1];
  for (const label of [header, sniffed, 'utf-8']) {
    if (!label) continue;
    try {
      return new TextDecoder(label).decode(buffer);
    } catch {
      // label tidak dikenal: coba berikutnya
    }
  }
  return buffer.toString('utf8');
}

function inflate(res: IncomingMessage) {
  const encoding = String(res.headers['content-encoding'] ?? '').toLowerCase();
  if (encoding === 'gzip' || encoding === 'x-gzip') return res.pipe(createGunzip());
  if (encoding === 'br') return res.pipe(new BrotliDecompress());
  if (encoding === 'deflate') return res.pipe(createInflate());
  return res;
}

/**
 * Pengambil halaman: hanya http/https, tidak mengikuti redirect ke alamat privat, ukuran dan waktu dibatasi.
 * Memakai node:http(s) langsung supaya pemeriksaan alamat terjadi pada saat koneksi (lihat `guardedLookup`).
 */
export function createPageFetcher(options: PageFetcherOptions = {}): PageFetcher {
  const { timeoutMs, maxBytes, maxRedirects, userAgent } = { ...DEFAULTS, ...options };
  const policy: UrlPolicy = { allowPrivateHosts: options.allowPrivateHosts ?? false };
  const lookup = guardedLookup(policy);

  function once(url: URL, signal: AbortSignal | undefined): Promise<IncomingMessage> {
    const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
    return new Promise((resolve, reject) => {
      const req = request(
        url,
        {
          method: 'GET',
          lookup,
          timeout: timeoutMs,
          ...(signal ? { signal } : {}),
          headers: {
            'user-agent': userAgent,
            accept: 'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.1',
            'accept-encoding': 'gzip, br, deflate',
            'accept-language': 'id,en;q=0.8',
          },
        },
        resolve,
      );
      req.on('timeout', () =>
        req.destroy(new ResearchError('fetch_timeout', 'Halaman terlalu lambat.')),
      );
      req.on('error', (err) => {
        if (err instanceof ResearchError) return reject(err);
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'EBLOCKED')
          return reject(new ResearchError('url_blocked', 'URL ditolak: alamat privat.'));
        if (signal?.aborted) return reject(err);
        reject(
          new ResearchError('fetch_failed', `Halaman tidak bisa diambil (${code ?? 'error'}).`),
        );
      });
      req.end();
    });
  }

  return async (rawUrl, signal) => {
    let url = assertFetchableUrl(rawUrl, policy);
    for (let hop = 0; ; hop++) {
      const res = await once(url, signal);
      const status = res.statusCode ?? 0;

      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (hop >= maxRedirects)
          throw new ResearchError('fetch_failed', 'Terlalu banyak redirect.');
        url = assertFetchableUrl(new URL(res.headers.location, url).toString(), policy);
        continue;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        throw new ResearchError('fetch_http', `Halaman menjawab HTTP ${status}.`);
      }
      const contentType = String(res.headers['content-type'] ?? 'text/html');
      if (!TEXTUAL.test(contentType)) {
        res.resume();
        throw new ResearchError(
          'fetch_unsupported',
          `Jenis konten tidak didukung (${contentType.split(';')[0]}).`,
        );
      }

      const chunks: Buffer[] = [];
      let size = 0;
      let truncated = false;
      const body = inflate(res);
      await new Promise<void>((resolve, reject) => {
        body.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            truncated = true;
            chunks.push(chunk.subarray(0, chunk.length - (size - maxBytes)));
            res.destroy();
            resolve();
            return;
          }
          chunks.push(chunk);
        });
        body.on('end', resolve);
        body.on('close', resolve);
        body.on('error', (err) => (truncated ? resolve() : reject(err)));
        res.on('error', (err) => (truncated ? resolve() : reject(err)));
        signal?.addEventListener(
          'abort',
          () => reject(signal.reason instanceof Error ? signal.reason : new Error('dibatalkan')),
          { once: true },
        );
      }).catch((err: unknown) => {
        if (err instanceof ResearchError) throw err;
        if (signal?.aborted) throw err;
        throw new ResearchError('fetch_failed', 'Isi halaman terputus.');
      });

      return {
        finalUrl: url.toString(),
        contentType,
        html: decodeBody(Buffer.concat(chunks), contentType),
        truncated,
      };
    }
  };
}
