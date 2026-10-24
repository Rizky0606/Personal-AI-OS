import { describe, expect, it } from 'vitest';
import { AppError } from '../../errors.js';
import type { NineRouterClient } from '../llm/client.js';
import { ResearchError } from './errors.js';
import { createResearchLlm } from './llm.js';

const client = (respond: (init: { timeoutMs?: number }) => Promise<Response>) => {
  const seen: { timeoutMs?: number }[] = [];
  const fake: NineRouterClient = {
    request: (_path, init = {}) => {
      seen.push({ ...(init.timeoutMs ? { timeoutMs: init.timeoutMs } : {}) });
      return respond(init);
    },
  };
  return { fake, seen };
};
const request = { model: 'research-main', user: 'tulis', maxTokens: 10 };

describe('LLM riset', () => {
  it('meneruskan timeoutMs ke klien 9Router', async () => {
    const { fake, seen } = client(() =>
      Promise.resolve(Response.json({ choices: [{ message: { content: 'laporan' } }] })),
    );
    await expect(
      createResearchLlm({ client: fake }).chat({ ...request, timeoutMs: 300_000 }),
    ).resolves.toBe('laporan');
    expect(seen).toEqual([{ timeoutMs: 300_000 }]);
  });

  it('timeout 9Router menjadi galat riset yang jelas (bukan "kesalahan di gateway")', async () => {
    const { fake } = client(() =>
      Promise.reject(
        new AppError(504, 'llm_upstream_timeout', 'Layanan model tidak menjawab tepat waktu.'),
      ),
    );
    const error = await createResearchLlm({ client: fake })
      .chat(request)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ResearchError);
    expect(error).toMatchObject({ code: 'llm_timeout', retryable: true });
  });

  it('model penalaran yang kehabisan token diberi pesan khusus', async () => {
    const { fake } = client(() =>
      Promise.resolve(
        Response.json({ choices: [{ message: { content: null }, finish_reason: 'length' }] }),
      ),
    );
    await expect(createResearchLlm({ client: fake }).chat(request)).rejects.toThrow(
      /kehabisan token/,
    );
  });
});
