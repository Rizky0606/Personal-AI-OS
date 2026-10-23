/**
 * Parser Markdown seperlunya untuk laporan riset (judul, paragraf, daftar, tebal, miring, tautan).
 * Laporan dibuat oleh pipeline sendiri dengan struktur terbatas, jadi bukan parser CommonMark penuh.
 */

export interface Inline {
  text: string;
  bold?: boolean;
  italic?: boolean;
  link?: string;
}

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3; inlines: Inline[] }
  | { type: 'paragraph'; inlines: Inline[] }
  | { type: 'list'; ordered: boolean; items: Inline[][] };

const INLINE =
  /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|(?<![\w*])\*([^*\s][^*]*)\*(?![\w*])|(?<![\w_])_([^_\s][^_]*)_(?![\w_])|`([^`]+)`/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    if (m[1] !== undefined && m[2] !== undefined) out.push({ text: m[1], link: m[2] });
    else if (m[3] !== undefined) out.push({ text: m[3], bold: true });
    else if (m[4] !== undefined) out.push({ text: m[4], italic: true });
    else if (m[5] !== undefined) out.push({ text: m[5], italic: true });
    else if (m[6] !== undefined) out.push({ text: m[6] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out.length > 0 ? out : [{ text }];
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;

export function parseBlocks(md: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | undefined;

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: 'paragraph', inlines: parseInline(paragraph.join(' ')) });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push({ type: 'list', ordered: list.ordered, items: list.items.map(parseInline) });
      list = undefined;
    }
  };

  for (const line of md.split('\n')) {
    const heading = HEADING.exec(line);
    const bullet = BULLET.exec(line);
    const ordered = ORDERED.exec(line);
    if (line.trim() === '') {
      flushParagraph();
      flushList();
    } else if (heading) {
      flushParagraph();
      flushList();
      blocks.push({
        type: 'heading',
        level: Math.min(3, (heading[1] ?? '#').length) as 1 | 2 | 3,
        inlines: parseInline(heading[2] ?? ''),
      });
    } else if (bullet || ordered) {
      flushParagraph();
      const isOrdered = !bullet;
      const content = (bullet ?? ordered)?.[1] ?? '';
      if (list && list.ordered !== isOrdered) flushList();
      list ??= { ordered: isOrdered, items: [] };
      list.items.push(content);
    } else if (list && /^\s{2,}\S/.test(line)) {
      // lanjutan butir daftar
      list.items[list.items.length - 1] += ` ${line.trim()}`;
    } else {
      flushList();
      paragraph.push(line.trim());
    }
  }
  flushParagraph();
  flushList();
  return blocks;
}
