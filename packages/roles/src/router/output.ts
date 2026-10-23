import { RouterOutputSchema, type RouterOutput } from '@aios/contracts';

export type ParsedRouterOutput = { ok: true; value: RouterOutput } | { ok: false; error: string };

/** Mengambil objek JSON dari balasan model: polos, dalam pagar kode ```json, atau diapit teks lain. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end > start) candidates.push(trimmed.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // coba kandidat berikutnya
    }
  }
  throw new Error('bukan JSON');
}

/** Mengurai dan memvalidasi keluaran router dengan skema contracts. Pesan error pendek, aman dikirim balik ke model. */
export function parseRouterOutput(text: string): ParsedRouterOutput {
  let raw: unknown;
  try {
    raw = extractJson(text);
  } catch {
    return { ok: false, error: 'balasan bukan JSON' };
  }
  const parsed = RouterOutputSchema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };
  const issue = parsed.error.issues[0];
  const path = issue?.path.length ? issue.path.join('.') : '(akar)';
  return {
    ok: false,
    error: `field "${path}" tidak sesuai skema: ${issue?.message ?? 'tidak valid'}`,
  };
}
