/** Saran lanjutan yang ditulis agent di akhir jawaban: `[saran]` lalu baris `- ...` lalu `[/saran]`. */
export const SUGGESTIONS_OPEN = '[saran]';
const SUGGESTIONS_CLOSE = '[/saran]';
export const MAX_SUGGESTIONS = 3;
export const MAX_SUGGESTION_CHARS = 120;

export interface SplitText {
  /** Jawaban tanpa blok saran (juga bila blok belum selesai ditulis). */
  body: string;
  suggestions: string[];
}

/**
 * Memisahkan blok saran dari jawaban. Blok yang belum tertutup (jawaban masih mengalir) tetap disembunyikan,
 * tetapi belum menghasilkan saran. Hanya blok terakhir yang dihitung; baris kosong dan duplikat dibuang.
 */
export function splitSuggestions(text: string): SplitText {
  const start = text.lastIndexOf(SUGGESTIONS_OPEN);
  if (start < 0) return { body: text, suggestions: [] };
  const body = text.slice(0, start).trimEnd();
  const end = text.indexOf(SUGGESTIONS_CLOSE, start);
  if (end < 0) return { body, suggestions: [] };
  const lines = text
    .slice(start + SUGGESTIONS_OPEN.length, end)
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter((line) => line.length > 0 && line.length <= MAX_SUGGESTION_CHARS);
  return { body, suggestions: [...new Set(lines)].slice(0, MAX_SUGGESTIONS) };
}
