const number = new Intl.NumberFormat('id-ID');

/** "1.234" untuk jumlah penuh. */
export const formatCount = (n: number): string => number.format(n);

/** Token ringkas: 842, 12,3 rb, 4,5 jt. */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  const compact = (value: number, unit: string) =>
    `${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(value)} ${unit}`;
  return n < 1_000_000 ? compact(n / 1000, 'rb') : compact(n / 1_000_000, 'jt');
}

/** Biaya dalam dolar: $0,0042 untuk nilai kecil, $12,35 selebihnya. */
export function formatCost(usd: number): string {
  const digits = usd > 0 && usd < 0.01 ? 4 : 2;
  return `$${new Intl.NumberFormat('id-ID', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(usd)}`;
}

/** Waktu jawaban: 840 ms, 2,4 dtk. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(ms / 1000)} dtk`;
}
