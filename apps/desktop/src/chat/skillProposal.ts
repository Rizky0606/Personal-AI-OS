/**
 * Blok `aios-skill-proposal` di jawaban agent adalah komunikasi mesin ke mesin: gateway sudah membuangnya dari
 * jawaban yang disimpan dan mengubahnya menjadi usulan (kartu terpisah). Penyaring ini menutup celah saat jawaban
 * masih mengalir: blok yang sudah lengkap, dan blok yang baru dibuka tapi belum ditutup, tidak ditampilkan.
 */
const CLOSED = /```aios-skill-proposal[ \t]*\r?\n[\s\S]*?```/g;
const OPEN_TAIL = /```aios-skill-proposal[\s\S]*$/;

export function stripSkillProposal(text: string): string {
  if (!text.includes('aios-skill-proposal')) return text;
  return text
    .replace(CLOSED, '')
    .replace(OPEN_TAIL, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
