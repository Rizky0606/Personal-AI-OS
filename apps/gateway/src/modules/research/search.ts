import { z } from 'zod';
import { ResearchError } from './errors.js';

export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
  engine: string | null;
  publishedDate: string | null;
}

export interface SearchClient {
  search(query: string, signal?: AbortSignal): Promise<SearchResult[]>;
}

const SearxResponseSchema = z.object({
  results: z.array(
    z.looseObject({
      url: z.string(),
      title: z.string().default(''),
      content: z.string().nullish(),
      engine: z.string().nullish(),
      publishedDate: z.string().nullish(),
    }),
  ),
});

/** SearXNG JSON (`/search?format=json`). Formatnya harus diaktifkan di settings.yml (`search.formats`). */
export function createSearxngClient(options: {
  baseUrl: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}): SearchClient {
  const { timeoutMs = 10_000, fetch: doFetch = fetch } = options;
  const base = options.baseUrl.replace(/\/+$/, '');

  return {
    async search(query, signal) {
      const params = new URLSearchParams({ q: query, format: 'json', categories: 'general' });
      const timeout = AbortSignal.timeout(timeoutMs);
      let res: Response;
      try {
        res = await doFetch(`${base}/search?${params.toString()}`, {
          headers: { accept: 'application/json' },
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
      } catch (err) {
        if (signal?.aborted) throw err;
        throw new ResearchError('search_unreachable', 'SearXNG tidak terjangkau.', true);
      }
      if (!res.ok) {
        await res.body?.cancel();
        // 403 biasanya berarti format json belum diaktifkan di SearXNG.
        throw new ResearchError(
          'search_http',
          `SearXNG menjawab HTTP ${res.status}.`,
          res.status >= 500,
        );
      }
      const parsed = SearxResponseSchema.safeParse(await res.json().catch(() => null));
      if (!parsed.success)
        throw new ResearchError('search_format', 'Jawaban SearXNG tidak dikenali.');
      return parsed.data.results.map((r) => ({
        url: r.url,
        title: r.title.trim(),
        snippet: (r.content ?? '').trim(),
        engine: r.engine ?? null,
        publishedDate: r.publishedDate ?? null,
      }));
    },
  };
}
