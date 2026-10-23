import type { CompareRequestSchema, CompareResponseSchema, Usage } from '@aios/contracts';
import type { z } from 'zod';
import type { NineRouterClient } from '../llm/client.js';
import { usageFromPayload } from '../llm/usage.js';

type Request = z.infer<typeof CompareRequestSchema>;
type Response = z.infer<typeof CompareResponseSchema>;

export interface CompareService {
  run(input: Request, signal?: AbortSignal): Promise<Response>;
}

/** Batas jawaban per model: pembanding untuk membandingkan, bukan menulis panjang. */
const MAX_TOKENS = 1024;
const MODEL_TIMEOUT_MS = 90_000;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function textOf(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) return '';
  const first: unknown = payload.choices[0];
  if (!isRecord(first) || !isRecord(first.message)) return '';
  return typeof first.message.content === 'string' ? first.message.content : '';
}

function errorOf(payload: unknown, status: number): string {
  if (isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === 'string') {
    return payload.error.message.slice(0, 300);
  }
  return `Model menjawab HTTP ${status}.`;
}

/**
 * Pembanding model: prompt yang sama ke 2-3 model lewat 9Router, paralel, tanpa streaming. Satu model yang gagal
 * tidak menggagalkan yang lain. Bukan run: tidak ada percakapan atau riwayat yang dibuat.
 */
export function createCompareService(deps: { client: NineRouterClient }): CompareService {
  async function one(model: string, prompt: string, signal?: AbortSignal) {
    const started = Date.now();
    const done = (
      ok: boolean,
      text: string,
      usage: Usage | null,
      error: string | null,
    ): Response['results'][number] => ({
      model,
      ok,
      text,
      latencyMs: Date.now() - started,
      usage,
      error,
    });
    try {
      const res = await deps.client.request('/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: false,
          max_tokens: MAX_TOKENS,
          messages: [{ role: 'user', content: prompt }],
        }),
        timeoutMs: MODEL_TIMEOUT_MS,
        ...(signal ? { signal } : {}),
      });
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) return done(false, '', null, errorOf(payload, res.status));
      return done(true, textOf(payload), usageFromPayload(payload), null);
    } catch (error) {
      // Pembatalan oleh klien dan gangguan jaringan sama-sama jadi galat model ini saja.
      return done(
        false,
        '',
        null,
        error instanceof Error && error.message
          ? error.message.slice(0, 300)
          : 'Model tidak terjangkau.',
      );
    }
  }

  return {
    async run({ prompt, models }, signal) {
      return { results: await Promise.all(models.map((m) => one(m, prompt, signal))) };
    },
  };
}
