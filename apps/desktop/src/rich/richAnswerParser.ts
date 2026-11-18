import { RICH_ANSWER_LIMITS, repairRichAnswer, type RichAnswer } from '@aios/contracts';

export type RichAnswerParseResult = { kind: 'valid'; value: RichAnswer } | { kind: 'invalid' };

/**
 * Isi blok `aios-ui`: JSON yang lolos `RichAnswerSchema` (ketat) setelah perbaikan longgar `repairRichAnswer`
 * (alias seperti `chartType` -> `chart`, field tak dikenal dibuang). Perbaikannya hanya di contracts; gateway
 * memakai fungsi yang sama saat menyimpan jawaban, di sini dipakai untuk blok yang masih mengalir dan pesan lama.
 */
export function parseRichAnswer(code: string): RichAnswerParseResult {
  if (new TextEncoder().encode(code).byteLength > RICH_ANSWER_LIMITS.maxJsonBytes)
    return { kind: 'invalid' };
  try {
    const value = repairRichAnswer(JSON.parse(code) as unknown);
    return value ? { kind: 'valid', value } : { kind: 'invalid' };
  } catch {
    return { kind: 'invalid' };
  }
}

/** Data yang masih bisa dibaca dari blok `aios-ui` yang tidak valid, untuk tampilan cadangan. */
export type RichFallbackSection =
  | { kind: 'pairs'; title?: string; rows: [string, string][] }
  | { kind: 'table'; title?: string; columns: string[]; rows: string[][] }
  | { kind: 'list'; title?: string; items: string[] };

/** JSON bebas dari model: setiap field diperiksa sendiri saat dibaca. */
type LooseObject = Partial<Record<string, unknown>>;

/** Hanya teks dan angka yang ditampilkan; objek, array, dan boolean diabaikan. */
function cellText(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

function firstText(o: LooseObject, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = cellText(o[key]);
    if (value) return value;
  }
  return null;
}

const HEAD_KEYS = ['label', 'title', 'name', 'key'] as const;
const BODY_KEYS = ['value', 'text', 'description'] as const;

function itemText(item: unknown): string | null {
  const plain = cellText(item);
  if (plain !== null) return plain || null;
  if (typeof item !== 'object' || item === null) return null;
  const head = firstText(item, HEAD_KEYS);
  const body = firstText(item, BODY_KEYS);
  return head && body ? `${head}: ${body}` : (head ?? body);
}

function fallbackSection(c: LooseObject): RichFallbackSection | null {
  const title = firstText(c, ['label', 'title', 'name']) ?? undefined;
  const max = RICH_ANSWER_LIMITS.maxTableRows;
  const labels = c.labels ?? c.categories;
  const values = c.values ?? c.data;
  if (Array.isArray(labels) && Array.isArray(values) && labels.length > 0) {
    const rows = labels
      .slice(0, max)
      .map((l, i): [string, string] => [cellText(l) ?? '', cellText(values[i]) ?? '']);
    return { kind: 'pairs', title, rows };
  }
  const columns = c.columns ?? c.headers;
  if (Array.isArray(columns) && columns.length > 0 && Array.isArray(c.rows)) {
    const cols = columns.map((col) => cellText(col) ?? '');
    const rows = c.rows
      .filter((row): row is unknown[] => Array.isArray(row))
      .slice(0, max)
      .map((row) => cols.map((_, j) => cellText(row[j]) ?? ''));
    return { kind: 'table', title, columns: cols, rows };
  }
  for (const key of ['items', 'options', 'steps']) {
    const list = c[key];
    if (!Array.isArray(list)) continue;
    const items = list.map(itemText).filter((t): t is string => t !== null);
    if (items.length > 0) return { kind: 'list', title, items: items.slice(0, max) };
  }
  // Komponen tunggal seperti metrik atau callout: label beserta nilai/teksnya.
  const body = firstText(c, BODY_KEYS);
  if (body) return { kind: 'list', items: [title ? `${title}: ${body}` : body] };
  return null;
}

/**
 * Mengambil data yang dikenali (label+nilai, kolom+baris, daftar item) dari JSON blok `aios-ui` yang gagal
 * divalidasi, supaya pemilik tetap melihat isinya tanpa JSON mentah. Kosong bila bukan JSON, terlalu besar, atau
 * tidak ada data yang dikenali.
 */
export function richAnswerFallbackData(code: string): RichFallbackSection[] {
  if (new TextEncoder().encode(code).byteLength > RICH_ANSWER_LIMITS.maxJsonBytes) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(code);
  } catch {
    return [];
  }
  const components =
    typeof raw === 'object' && raw !== null ? (raw as LooseObject).components : undefined;
  const candidates: unknown[] = Array.isArray(components)
    ? components
    : Array.isArray(raw)
      ? raw
      : [raw];
  return candidates
    .filter((c): c is LooseObject => typeof c === 'object' && c !== null && !Array.isArray(c))
    .map(fallbackSection)
    .filter((s): s is RichFallbackSection => s !== null)
    .slice(0, RICH_ANSWER_LIMITS.maxComponents);
}
