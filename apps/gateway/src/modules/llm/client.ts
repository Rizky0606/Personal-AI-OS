import { AppError } from '../../errors.js';

export interface NineRouterRequest {
  method?: string;
  headers?: Record<string, string>;
  /** String atau Buffer supaya bisa dikirim ulang saat retry. */
  body?: string | Buffer;
  /** Pembatalan dari pemanggil (mis. klien memutus koneksi). Tidak diretry. */
  signal?: AbortSignal;
  /** Batas waktu sampai header respons tiba; mengalahkan default klien. */
  timeoutMs?: number;
}

/** Klien OpenAI-compatible untuk 9Router. Satu-satunya tempat gateway memegang API key 9Router. */
export interface NineRouterClient {
  /**
   * `path` relatif terhadap NINEROUTER_URL, diawali `/` (boleh dengan query).
   * Mengembalikan Response apa adanya (status non-2xx tidak melempar); body belum dibaca.
   */
  request(path: string, init?: NineRouterRequest): Promise<Response>;
}

export interface NineRouterClientOptions {
  baseUrl: string;
  apiKey?: string | undefined;
  /** Batas waktu sampai header respons. Respons non-stream baru mengirim header setelah model selesai. */
  timeoutMs?: number;
  /** Percobaan ulang tambahan untuk error sementara. */
  retries?: number;
  retryDelayMs?: number;
  fetch?: typeof fetch;
}

export const DEFAULT_TIMEOUT_MS = 120_000;
export const DEFAULT_RETRIES = 2;
export const DEFAULT_RETRY_DELAY_MS = 250;

/** 502/503 berarti permintaan belum diproses. 504 tidak diretry: model mungkin sudah bekerja dan berbiaya. */
const RETRYABLE_STATUS = new Set([502, 503]);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const isAbort = (err: unknown) =>
  err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');

export function createNineRouterClient(options: NineRouterClientOptions): NineRouterClient {
  const {
    apiKey,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
    fetch: doFetch = fetch,
  } = options;
  const base = new URL(options.baseUrl.replace(/\/+$/, ''));
  const basePath = base.pathname.replace(/\/+$/, '');

  /** Menolak path yang setelah dinormalisasi keluar dari NINEROUTER_URL (mis. `/../api/keys`). */
  function resolve(path: string): URL {
    const target = new URL(`${basePath}${path}`, base.origin);
    if (target.origin !== base.origin || !target.pathname.startsWith(`${basePath}/`)) {
      throw new AppError(400, 'invalid_llm_path', 'Path model tidak valid.');
    }
    return target;
  }

  async function attempt(url: URL, init: NineRouterRequest): Promise<Response> {
    const controller = new AbortController();
    const onCallerAbort = () => controller.abort(init.signal?.reason);
    if (init.signal?.aborted) onCallerAbort();
    init.signal?.addEventListener('abort', onCallerAbort, { once: true });
    const timer = setTimeout(
      () => controller.abort(new DOMException('timeout', 'TimeoutError')),
      init.timeoutMs ?? timeoutMs,
    );
    try {
      return await doFetch(url, {
        method: init.method ?? 'GET',
        headers: { ...init.headers, ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
        ...(init.body === undefined ? {} : { body: init.body }),
        redirect: 'manual',
        signal: controller.signal,
      });
    } finally {
      // Timeout hanya untuk menunggu header; stream yang sudah mengalir diawasi pemanggil.
      clearTimeout(timer);
      init.signal?.removeEventListener('abort', onCallerAbort);
    }
  }

  return {
    async request(path, init = {}) {
      const url = resolve(path);
      for (let n = 0; ; n++) {
        const last = n >= retries;
        try {
          const res = await attempt(url, init);
          if (!last && RETRYABLE_STATUS.has(res.status)) {
            await res.body?.cancel();
          } else {
            return res;
          }
        } catch (err) {
          if (init.signal?.aborted) throw err;
          if (isAbort(err)) {
            throw new AppError(
              504,
              'llm_upstream_timeout',
              'Layanan model tidak menjawab tepat waktu.',
            );
          }
          if (last) {
            throw new AppError(502, 'llm_upstream_unreachable', 'Layanan model tidak terjangkau.');
          }
        }
        await sleep(retryDelayMs * 2 ** n);
      }
    },
  };
}
