const URL_RE = /https?:\/\/[^\s<>"'`)\]]+/gi;
const TRAILING = /[.,;:!?]+$/;

/** URL http(s) dalam teks, tanpa tanda baca penutup kalimat. */
export function urlsIn(text: string): string[] {
  return (text.match(URL_RE) ?? []).map((u) => u.replace(TRAILING, ''));
}

/**
 * Izin jaringan untuk tautan yang pemilik tulis sendiri di pesannya: setiap URL pada detail izin harus
 * persis salah satu URL di prompt. Detail tanpa URL (mis. pencarian web) tidak pernah lolos.
 */
export function isLinkFromPrompt(detail: string, prompt: string): boolean {
  const wanted = urlsIn(detail);
  if (wanted.length === 0) return false;
  const given = new Set(urlsIn(prompt));
  return wanted.every((u) => given.has(u));
}

export const LINK_INSTRUCTION = [
  '',
  '# Tautan di pesan',
  'Bila pesan pemilik berisi tautan (http/https), baca isinya dengan tool fetch lebih dulu, lalu analisis dan jawab berdasarkan isi halaman itu; sebut bila halaman tidak bisa dibuka. Jangan membuka tautan lain yang tidak ditulis pemilik tanpa alasan jelas.',
].join('\n');
