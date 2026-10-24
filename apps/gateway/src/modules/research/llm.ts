import type { NineRouterClient } from '../llm/client.js';
import { usageFromPayload, type UsageRecorder } from '../llm/usage.js';
import { AppError } from '../../errors.js';
import { ResearchError } from './errors.js';

export interface ResearchLlmRequest {
  model: string;
  system?: string | undefined;
  user: string;
  maxTokens: number;
  temperature?: number;
  /** Batas menunggu jawaban (bawaan klien 9Router 120 detik); laporan panjang butuh lebih. */
  timeoutMs?: number;
  signal?: AbortSignal | undefined;
}

/** Panggilan model untuk riset: selalu lewat 9Router, pemakaian token dicatat ke run riset. */
export interface ResearchLlm {
  chat(request: ResearchLlmRequest): Promise<string>;
}

export function createResearchLlm(deps: {
  client: NineRouterClient;
  usage?: UsageRecorder;
  /** Run riset yang menerima pencatatan usage. */
  runId?: () => string | undefined;
  log?: { warn: (obj: object, msg: string) => void };
}): ResearchLlm {
  const { client, usage, log } = deps;
  return {
    async chat({ model, system, user, maxTokens, temperature = 0, timeoutMs, signal }) {
      const res = await client
        .request('/chat/completions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model,
            temperature,
            max_tokens: maxTokens,
            stream: false,
            messages: [
              ...(system ? [{ role: 'system', content: system }] : []),
              { role: 'user', content: user },
            ],
          }),
          ...(signal ? { signal } : {}),
          ...(timeoutMs ? { timeoutMs } : {}),
        })
        .catch((err: unknown) => {
          // Galat klien 9Router (timeout, tak terjangkau) menjadi galat riset dengan pesan yang jelas.
          if (err instanceof AppError && err.code === 'llm_upstream_timeout') {
            throw new ResearchError(
              'llm_timeout',
              'Model terlalu lama menjawab. Coba lagi, atau pilih model yang lebih cepat untuk riset.',
              true,
            );
          }
          if (err instanceof AppError) {
            throw new ResearchError('llm_unreachable', 'Layanan model tidak terjangkau.', true);
          }
          throw err;
        });
      if (!res.ok) {
        await res.body?.cancel();
        throw new ResearchError(
          'llm_http',
          `Layanan model menjawab HTTP ${res.status}.`,
          res.status >= 500 || res.status === 429,
        );
      }
      const json = (await res.json().catch(() => null)) as {
        choices?: { message?: { content?: unknown }; finish_reason?: unknown }[];
      } | null;
      const choice = json?.choices?.[0];
      const content = choice?.message?.content;
      if (typeof content !== 'string' || !content.trim()) {
        // Model penalaran bisa menghabiskan seluruh max_tokens untuk berpikir tanpa menulis jawaban.
        throw new ResearchError(
          'llm_empty',
          choice?.finish_reason === 'length'
            ? 'Model kehabisan token sebelum menulis jawaban. Pilih model riset tanpa mode penalaran panjang.'
            : 'Model tidak memberi jawaban.',
          true,
        );
      }
      const runId = deps.runId?.();
      const used = usageFromPayload(json);
      if (usage && runId && used) {
        usage
          .record(runId, used)
          .catch((err: unknown) => log?.warn({ err }, 'gagal mencatat usage riset'));
      }
      return content;
    },
  };
}
