export interface HistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

const MAX_HISTORY_CHARS = 40_000;
const MAX_TURN_CHARS = 4_000;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

/**
 * Prompt omp dengan riwayat percakapan di depannya. Omp memulai proses baru tiap run, jadi tanpa ini
 * "lanjut" atau "yang tadi" tidak punya arti. Giliran terbaru dipertahankan bila melebihi batas.
 */
export function withHistory(prompt: string, history: readonly HistoryTurn[] | undefined): string {
  if (!history?.length) return prompt;
  const lines: string[] = [];
  let total = 0;
  for (const turn of [...history].reverse()) {
    const line = `${turn.role === 'user' ? 'Pemilik' : 'Kamu'}: ${clip(turn.content, MAX_TURN_CHARS)}`;
    if (total + line.length > MAX_HISTORY_CHARS) break;
    lines.unshift(line);
    total += line.length;
  }
  if (lines.length === 0) return prompt;
  return [
    '# Riwayat percakapan sebelumnya',
    'Ini giliran sebelumnya di percakapan yang sama, hanya untuk konteks. Jawab pesan terakhir di bawah.',
    '',
    lines.join('\n\n'),
    '',
    '# Pesan terakhir pemilik',
    prompt,
  ].join('\n');
}
