export interface ReportSource {
  /** Nomor rujukan `[n]` di isi laporan. */
  n: number;
  title: string;
  url: string;
  meta: string;
}

export interface ParsedReport {
  bodyMd: string;
  sources: ReportSource[];
  /** Peta nomor rujukan ke URL, supaya `[n]` di isi laporan bisa diklik. */
  citations: Map<number, string>;
}

const HEADING = /^##\s+daftar sumber\s*$/im;
const ITEM = /^\s*[-*]\s+\[(\d{1,3})]\s+\[(.*)]\((\S+?)\)(?:\s+[—-]\s+(.*))?\s*$/;

/**
 * Server menyusun laporan dengan rujukan `[n]` yang dinomori ulang menurut kemunculan, diakhiri bagian
 * `## Daftar sumber` berisi `- [n] [Judul](url) — domain, diakses tanggal`. Nomor itu mengacu ke daftar di
 * laporan sendiri, bukan urutan `sources` di API, jadi daftar inilah yang diurai.
 */
export function parseReport(markdown: string): ParsedReport {
  const heading = HEADING.exec(markdown);
  if (!heading) return { bodyMd: markdown.trimEnd(), sources: [], citations: new Map() };

  const bodyMd = markdown.slice(0, heading.index).trimEnd();
  const rest = markdown.slice(heading.index + heading[0].length);
  const sources: ReportSource[] = [];
  for (const line of rest.split('\n')) {
    const match = ITEM.exec(line);
    if (!match) continue;
    const url = match[3]!.replaceAll('%28', '(').replaceAll('%29', ')').replaceAll('%20', ' ');
    if (!/^https?:\/\//i.test(url)) continue;
    sources.push({
      n: Number(match[1]),
      title: match[2]!.trim(),
      url,
      meta: (match[4] ?? '').trim(),
    });
  }
  return { bodyMd, sources, citations: new Map(sources.map((s) => [s.n, s.url])) };
}
