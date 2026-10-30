import { parseMarkdown, type Block } from './parse';

const SETTLED: Partial<Record<Block['type'], true>> = {
  heading: true,
  paragraph: true,
  rule: true,
  code: true,
};

/**
 * Parser untuk teks yang tumbuh di ujung (streaming): blok sebelum jeda baris terakhir yang aman
 * diparse sekali lalu disimpan, jadi tiap delta hanya mengurai ekor. Daftar, kutipan, tabel, dan pagar
 * kode yang belum ditutup tidak pernah dianggap selesai (jeda di dalamnya bisa berlanjut).
 */
export function createIncrementalParser(): (source: string) => Block[] {
  let prefix = '';
  let settled: Block[] = [];
  return (source) => {
    if (!source.startsWith(prefix)) {
      prefix = '';
      settled = [];
    }
    const tail = source.slice(prefix.length);
    const cut = tail.lastIndexOf('\n\n');
    if (cut > 0) {
      const blocks = parseMarkdown(tail.slice(0, cut));
      const last = blocks.at(-1);
      if (last && SETTLED[last.type] && !blocks.some((b) => b.type === 'code' && !b.closed)) {
        prefix += tail.slice(0, cut + 2);
        settled = [...settled, ...blocks];
        return [...settled, ...parseMarkdown(source.slice(prefix.length))];
      }
    }
    return [...settled, ...parseMarkdown(tail)];
  };
}
