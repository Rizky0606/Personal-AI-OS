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
  'Isi tautan yang ditulis pemilik sudah diambil sistem dan ditempel di pesan pada bagian "Isi tautan di pesan"; pakai itu sebagai bahan dan sebut sumbernya. Pakai tool fetch hanya bila isi yang ditempel tidak cukup atau tertulis gagal dibuka, dan hanya untuk tautan dari pemilik.',
].join('\n');
