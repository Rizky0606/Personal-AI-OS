import type { NineRouterClient } from '../llm/client.js';

export const TITLE_MAX_WORDS = 6;
const TITLE_MAX_CHARS = 80;
const TITLE_TIMEOUT_MS = 15_000;
const SOURCE_MAX_CHARS = 500;

const SYSTEM_PROMPT = `Buat judul percakapan dari pesan pertama pengguna. Maksimal ${TITLE_MAX_WORDS} kata, dalam bahasa yang sama dengan pesan. Balas hanya judulnya, tanpa tanda kutip, tanpa titik di akhir.`;

/** Merapikan keluaran model: satu baris, tanpa kutip/markdown, paling banyak 6 kata. */
export function cleanTitle(raw: string): string {
  const words = raw
    .split('\n')[0]!
    .replace(/[*_`#"“”‘’]/g, '')
    .replace(/^(judul|title)\s*:\s*/i, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, TITLE_MAX_WORDS);
  return words
    .join(' ')
    .replace(/[.,;:!\s]+$/, '')
    .slice(0, TITLE_MAX_CHARS);
}

export interface TitleService {
  /** Judul dari model kecil; bila gagal, enam kata pertama pesan. Tidak pernah melempar. */
  generate(firstMessage: string): Promise<string>;
}

export function createTitleService(deps: {
  client: NineRouterClient;
  model: string;
  log?: { warn: (obj: object, msg: string) => void };
}): TitleService {
  const { client, model, log } = deps;

  return {
    async generate(firstMessage) {
      const fallback = cleanTitle(firstMessage);
      try {
        const res = await client.request('/chat/completions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          timeoutMs: TITLE_TIMEOUT_MS,
          body: JSON.stringify({
            model,
            temperature: 0,
            max_tokens: 30,
            stream: false,
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: firstMessage.slice(0, SOURCE_MAX_CHARS) },
            ],
          }),
        });
        if (!res.ok) {
          await res.body?.cancel();
          throw new Error(`HTTP ${res.status}`);
        }
        const json = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
        const content = json.choices?.[0]?.message?.content;
        const title = typeof content === 'string' ? cleanTitle(content) : '';
        return title || fallback;
      } catch (err) {
        log?.warn({ err }, 'judul otomatis gagal, memakai kata awal pesan');
        return fallback;
      }
    },
  };
}
