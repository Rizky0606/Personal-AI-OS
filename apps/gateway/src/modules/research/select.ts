import type { SearchResult } from './search.js';

/**
 * Domain yang hampir tidak pernah memberi teks artikel yang bisa dipercaya: media sosial dan video
 * (butuh login atau tanpa teks), bank gambar, dan situs unggah dokumen.
 */
export const LOW_QUALITY_DOMAINS = [
  'facebook.com',
  'instagram.com',
  'tiktok.com',
  'twitter.com',
  'x.com',
  'pinterest.com',
  'linkedin.com',
  'youtube.com',
  'youtu.be',
  'vimeo.com',
  'quora.com',
  'scribd.com',
  'slideshare.net',
  'shutterstock.com',
  'istockphoto.com',
  'gettyimages.com',
  'alamy.com',
  'pngtree.com',
];

/** Berkas yang tidak bisa diekstrak sebagai teks HTML. */
const UNSUPPORTED_EXTENSION =
  /\.(pdf|docx?|xlsx?|pptx?|zip|rar|7z|gz|mp3|mp4|avi|mov|jpe?g|png|gif|webp|svg|exe|apk)$/i;

const TRACKING_PARAMS = /^(utm_.*|fbclid|gclid|igshid|mc_.*|ref|ref_src|source|spm)$/i;

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function isLowQualityDomain(url: string): boolean {
  const host = domainOf(url);
  return LOW_QUALITY_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

/** Kunci pembanding URL: tanpa skema, www, fragmen, parameter pelacak, dan garis miring penutup. */
export function normalizeUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const params = [...url.searchParams.entries()]
      .filter(([key]) => !TRACKING_PARAMS.test(key))
      .sort(([a], [b]) => a.localeCompare(b));
    const query = params.length > 0 ? `?${new URLSearchParams(params).toString()}` : '';
    const path = url.pathname.replace(/\/+$/, '') || '/';
    return `${url.hostname.toLowerCase().replace(/^www\./, '')}${path}${query}`;
  } catch {
    return raw;
  }
}

export interface Candidate extends SearchResult {
  /** Indeks kueri yang menemukannya (sub-pertanyaan; yang terakhir adalah pertanyaan utama). */
  queryIndex: number;
  /** Peringkat di hasil kueri itu, mulai dari 0. */
  rank: number;
}

export interface SelectOptions {
  /** Jumlah kandidat yang dikembalikan. */
  pool: number;
  /** Maksimal kandidat dari satu domain agar sumber beragam. */
  perDomain: number;
}

/**
 * Menggabungkan hasil semua kueri: buang duplikat dan domain berkualitas rendah serta berkas yang tidak
 * didukung, ambil bergiliran dari tiap kueri menurut peringkat (agar tiap sub-pertanyaan terwakili),
 * dan batasi jumlah per domain.
 */
export function selectCandidates(perQuery: SearchResult[][], options: SelectOptions): Candidate[] {
  const seen = new Set<string>();
  const perDomain = new Map<string, number>();
  const out: Candidate[] = [];
  const longest = Math.max(0, ...perQuery.map((r) => r.length));

  for (let rank = 0; rank < longest && out.length < options.pool; rank++) {
    for (
      let queryIndex = 0;
      queryIndex < perQuery.length && out.length < options.pool;
      queryIndex++
    ) {
      const result = perQuery[queryIndex]?.[rank];
      if (!result) continue;
      let url: URL;
      try {
        url = new URL(result.url);
      } catch {
        continue;
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
      if (UNSUPPORTED_EXTENSION.test(url.pathname) || isLowQualityDomain(result.url)) continue;
      const key = normalizeUrl(result.url);
      if (seen.has(key)) continue;
      const domain = domainOf(result.url);
      if ((perDomain.get(domain) ?? 0) >= options.perDomain) continue;
      seen.add(key);
      perDomain.set(domain, (perDomain.get(domain) ?? 0) + 1);
      out.push({ ...result, queryIndex, rank });
    }
  }
  return out;
}
