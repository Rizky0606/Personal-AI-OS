import { copy } from '../copy';
import { formatCost, formatTokens } from '../lib/format';

/**
 * Teks ringkasan kuota di kaki sidebar, dengan aturan yang sama seperti layar Kuota: biaya hanya tampil bila ada
 * nilai di atas 0 (gateway belum selalu mencatat biaya), dan seluruh baris disembunyikan (null) bila tidak ada data
 * token sama sekali.
 */
export function quotaLabel(
  quota: { totals: { inputTokens: number; outputTokens: number; costUsd: number } } | undefined,
): string | null {
  if (!quota) return null;
  const tokens = quota.totals.inputTokens + quota.totals.outputTokens;
  if (tokens <= 0) return null;
  return quota.totals.costUsd > 0
    ? copy.status.quotaSummary(formatTokens(tokens), formatCost(quota.totals.costUsd))
    : copy.status.quotaTokens(formatTokens(tokens));
}
