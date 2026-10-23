import type { Complete } from '@aios/roles';
import type { NineRouterClient } from '../llm/client.js';

const ROUTER_TIMEOUT_MS = 20_000;
const ROUTER_MAX_TOKENS = 400;

/** Memanggil combo router (mis. router-fast) lewat 9Router: tanpa stream, suhu dari pemanggil (selalu 0). */
export function createRouterComplete(client: NineRouterClient, model: string): Complete {
  return async ({ messages, temperature, signal }) => {
    const res = await client.request('/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature,
        stream: false,
        max_tokens: ROUTER_MAX_TOKENS,
        messages,
      }),
      timeoutMs: ROUTER_TIMEOUT_MS,
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(`router: HTTP ${res.status}`);
    }
    const json = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('router: balasan tanpa isi');
    return content;
  };
}
