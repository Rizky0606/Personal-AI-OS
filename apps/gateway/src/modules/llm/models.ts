import type { ModelInfoSchema } from '@aios/contracts';
import { z } from 'zod';
import { AppError } from '../../errors.js';
import type { NineRouterClient } from './client.js';

type ModelInfo = z.infer<typeof ModelInfoSchema>;

export const MODELS_TTL_MS = 5 * 60_000;
const MODELS_TIMEOUT_MS = 10_000;

const UpstreamModelsSchema = z.object({
  data: z.array(z.object({ id: z.string().min(1), owned_by: z.string().optional() })),
});

const titleCase = (s: string) =>
  s
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ');

/** Combo: "coding-main" → "Coding Main". Model: "aisubs/gpt-6-sol" → "gpt-6-sol (aisubs)". */
export function friendlyLabel(id: string, kind: ModelInfo['kind']): string {
  if (kind === 'combo') return titleCase(id);
  const slash = id.indexOf('/');
  return slash > 0 && slash < id.length - 1 ? `${id.slice(slash + 1)} (${id.slice(0, slash)})` : id;
}

export interface ModelsService {
  list(): Promise<ModelInfo[]>;
}

export interface ModelsDeps {
  client: NineRouterClient;
  now?: () => number;
  ttlMs?: number;
  log?: { warn: (obj: object, msg: string) => void };
}

export function createModelsService({
  client,
  now = Date.now,
  ttlMs = MODELS_TTL_MS,
  log,
}: ModelsDeps): ModelsService {
  let cache: { at: number; items: ModelInfo[] } | undefined;
  let inflight: Promise<ModelInfo[]> | undefined;

  async function fetchModels(): Promise<ModelInfo[]> {
    const res = await client.request('/models', { timeoutMs: MODELS_TIMEOUT_MS });
    if (!res.ok) {
      await res.body?.cancel();
      throw new AppError(502, 'llm_upstream_error', `Layanan model menjawab HTTP ${res.status}.`);
    }
    const parsed = UpstreamModelsSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError(
        502,
        'llm_upstream_error',
        'Daftar model dari layanan model tidak dikenali.',
      );
    }
    const items = parsed.data.data.map((m): ModelInfo => {
      const kind = m.owned_by === 'combo' ? 'combo' : 'model';
      return { id: m.id, label: friendlyLabel(m.id, kind), kind, ownedBy: m.owned_by ?? 'unknown' };
    });
    // Combo dulu: itu yang dipilih pengguna; model mentah menyusul.
    return items.sort((a, b) =>
      a.kind === b.kind ? a.id.localeCompare(b.id) : a.kind === 'combo' ? -1 : 1,
    );
  }

  return {
    async list() {
      if (cache && now() - cache.at < ttlMs) return cache.items;
      inflight ??= fetchModels()
        .then((items) => {
          cache = { at: now(), items };
          return items;
        })
        .finally(() => {
          inflight = undefined;
        });
      try {
        return await inflight;
      } catch (err) {
        // Daftar lama lebih berguna daripada error saat 9Router sedang gangguan sesaat.
        if (cache) {
          log?.warn({ err }, 'daftar model gagal diperbarui, memakai cache lama');
          return cache.items;
        }
        throw err;
      }
    },
  };
}
