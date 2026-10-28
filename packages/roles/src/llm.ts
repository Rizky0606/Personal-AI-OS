/** Pesan untuk model pendukung (pemecah tugas, pengurai jadwal, pencari web). */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Memanggil model pendukung (combo router-fast). Pemanggil menetapkan model; suhu selalu 0. */
export type Complete = (request: {
  messages: ChatMessage[];
  temperature: 0;
  signal?: AbortSignal | undefined;
}) => Promise<string>;

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
