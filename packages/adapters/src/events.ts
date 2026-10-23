import { AgentEventSchema, type AgentEvent, type Usage } from '@aios/contracts';
import { AdapterError } from './types.js';

/** Event `error` dari kegagalan apa pun. Pesan dari luar AdapterError tidak diteruskan (bisa memuat URL atau header). */
export function errorEvent(err: unknown): Extract<AgentEvent, { type: 'error' }> {
  if (err instanceof AdapterError) {
    return { type: 'error', code: err.code, message: err.message, retryable: err.retryable };
  }
  return {
    type: 'error',
    code: 'adapter_failure',
    message: 'Mesin agent gagal dengan kesalahan tak terduga.',
    retryable: false,
  };
}

/** Ringkasan satu baris untuk `run.completed`. */
export function summarize(text: string, max = 200): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

const count = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(Math.trunc(v), 2 ** 40) : 0;
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Usage gaya OpenAI (`prompt_tokens`) atau gaya Anthropic/Responses (`input_tokens`). */
export function parseUsage(raw: unknown): Usage | null {
  if (!isRecord(raw)) return null;
  const usage: Usage = {
    inputTokens: count(raw.prompt_tokens ?? raw.input_tokens),
    outputTokens: count(raw.completion_tokens ?? raw.output_tokens),
  };
  const out = isRecord(raw.completion_tokens_details) ? raw.completion_tokens_details : {};
  const inn = isRecord(raw.prompt_tokens_details) ? raw.prompt_tokens_details : {};
  const reasoning = count(out.reasoning_tokens);
  const cached = count(inn.cached_tokens);
  if (reasoning) usage.reasoningTokens = reasoning;
  if (cached) usage.cachedTokens = cached;
  return usage.inputTokens || usage.outputTokens ? usage : null;
}

/**
 * Menyaring aliran event dari mesin: yang tidak lolos skema AgentEvent dibuang (dilaporkan lewat
 * `onInvalid`), supaya protokol mesin yang berubah tidak merusak klien.
 */
export async function* normalizeEvents(
  source: AsyncIterable<unknown>,
  onInvalid?: (raw: unknown, issues: string) => void,
): AsyncGenerator<AgentEvent> {
  for await (const raw of source) {
    const parsed = AgentEventSchema.safeParse(raw);
    if (parsed.success) yield parsed.data;
    else onInvalid?.(raw, parsed.error.issues.map((i) => i.message).join('; '));
  }
}
