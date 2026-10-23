import type { NineRouterClient } from '../llm/client.js';
import { usageFromPayload, type UsageRecorder } from '../llm/usage.js';
import { ResearchError } from './errors.js';

export interface ResearchLlmRequest {
  model: string;
  system?: string | undefined;
  user: string;
  maxTokens: number;
  temperature?: number;
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
    async chat({ model, system, user, maxTokens, temperature = 0, signal }) {
      const res = await client.request('/chat/completions', {
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
        choices?: { message?: { content?: unknown } }[];
      } | null;
      const content = json?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) {
        throw new ResearchError('llm_empty', 'Model tidak memberi jawaban.', true);
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
