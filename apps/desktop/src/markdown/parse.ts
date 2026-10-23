import { parseInlines, type Inline } from './inline';

export interface ListItem {
  inlines: Inline[];
  children: Block[];
}

export type Block =
  | { type: 'heading'; level: number; inlines: Inline[] }
  | { type: 'paragraph'; inlines: Inline[] }
  /** closed=false: pagar penutup belum datang (jawaban masih mengalir). */
  | { type: 'code'; language: string; code: string; closed: boolean }
  | { type: 'quote'; blocks: Block[] }
  | { type: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { type: 'table'; header: Inline[][]; rows: Inline[][][] }
  | { type: 'rule' };

const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^ {0,3}([-*_])(\s*\1){2,}\s*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*).*$/;
const LIST = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

const isBlank = (line: string): boolean => line.trim() === '';

function isTableSeparator(line: string): boolean {
  return TABLE_SEP.test(line) && line.includes('-') && line.includes('|');
}

function isTableStart(lines: string[], i: number): boolean {
  const next = lines[i + 1];
  return next !== undefined && lines[i]!.includes('|') && isTableSeparator(next);
}

function cells(line: string): string[] {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1);
  return t.split(/(?<!\\)\|/).map((c) => c.trim().replaceAll('\\|', '|'));
}

function isBlockStart(trimmed: string): boolean {
  return FENCE.test(trimmed) || HEADING.test(trimmed) || QUOTE.test(trimmed);
}

interface RawItem {
  indent: number;
  ordered: boolean;
  number: number;
  text: string;
}

/** Membangun daftar bersarang dari item datar menurut indentasi. */
function buildLists(items: RawItem[], from: number, to: number): Block[] {
  const result: Block[] = [];
  let i = from;
  while (i < to) {
    const first = items[i]!;
    const built: ListItem[] = [];
    while (i < to && items[i]!.indent >= first.indent) {
      const item = items[i]!;
      if (item.indent === first.indent && item.ordered !== first.ordered) break;
      let j = i + 1;
      while (j < to && items[j]!.indent > first.indent) j++;
      built.push({
        inlines: parseInlines(item.text),
        children: j > i + 1 ? buildLists(items, i + 1, j) : [],
      });
      i = j;
    }
    result.push({ type: 'list', ordered: first.ordered, start: first.number, items: built });
  }
  return result;
}

function parseList(lines: string[], from: number, out: Block[]): number {
  const raw: RawItem[] = [];
  let i = from;
  while (i < lines.length) {
    const line = lines[i]!;
    const m = LIST.exec(line);
    if (m && !RULE.test(line)) {
      const marker = m[2]!;
      raw.push({
        indent: m[1]!.replaceAll('\t', '    ').length,
        ordered: /^\d/.test(marker),
        number: Number.parseInt(marker, 10) || 1,
        text: m[3]!,
      });
      i++;
    } else if (
      !isBlank(line) &&
      raw.length > 0 &&
      line.startsWith(' ') &&
      !isBlockStart(line.trim())
    ) {
      // Lanjutan baris item sebelumnya.
      raw[raw.length - 1]!.text += `\n${line.trim()}`;
      i++;
    } else if (isBlank(line) && i + 1 < lines.length && LIST.test(lines[i + 1]!)) {
      i++;
    } else {
      break;
    }
  }
  out.push(...buildLists(raw, 0, raw.length));
  return i;
}

function parseFenced(lines: string[], from: number, out: Block[]): number {
  const open = FENCE.exec(lines[from]!)!;
  const fence = open[1]!;
  const body: string[] = [];
  let i = from + 1;
  let closed = false;
  while (i < lines.length) {
    const t = lines[i]!.trim();
    if (t.length >= fence.length && [...t].every((ch) => ch === fence[0])) {
      closed = true;
      i++;
      break;
    }
    body.push(lines[i]!);
    i++;
  }
  out.push({ type: 'code', language: open[2] ?? '', code: body.join('\n'), closed });
  return i;
}

function parseParagraph(lines: string[], from: number, out: Block[]): number {
  const buf: string[] = [];
  let i = from;
  while (i < lines.length) {
    const line = lines[i]!;
    if (isBlank(line)) break;
    const startsOther =
      FENCE.test(line) ||
      HEADING.test(line) ||
      QUOTE.test(line) ||
      RULE.test(line) ||
      isTableStart(lines, i);
    if (i > from && startsOther) break;
    buf.push(line.trimEnd());
    i++;
  }
  out.push({ type: 'paragraph', inlines: parseInlines(buf.join('\n')) });
  return i;
}

function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    let m: RegExpExecArray | null;
    if (isBlank(line)) {
      i++;
    } else if (FENCE.test(line)) {
      i = parseFenced(lines, i, blocks);
    } else if ((m = HEADING.exec(line))) {
      blocks.push({
        type: 'heading',
        level: m[1]!.length,
        inlines: parseInlines(m[2]!),
      });
      i++;
    } else if (RULE.test(line)) {
      blocks.push({ type: 'rule' });
      i++;
    } else if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length) {
        const q = QUOTE.exec(lines[i]!);
        if (!q) break;
        inner.push(q[1]!);
        i++;
      }
      blocks.push({ type: 'quote', blocks: parseBlocks(inner) });
    } else if (isTableStart(lines, i)) {
      const header = cells(line).map(parseInlines);
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && !isBlank(lines[i]!) && lines[i]!.includes('|')) {
        rows.push(cells(lines[i]!).map(parseInlines));
        i++;
      }
      blocks.push({ type: 'table', header, rows });
    } else if (LIST.test(line)) {
      i = parseList(lines, i, blocks);
    } else {
      i = parseParagraph(lines, i, blocks);
    }
  }
  return blocks;
}

/**
 * Markdown ringan untuk jawaban chat dan laporan riset: judul, paragraf, daftar bersarang, kutipan, blok
 * kode berpagar, tabel, garis, dan inline. Tanpa HTML mentah, jadi aman dirender sebagai elemen React.
 */
export function parseMarkdown(source: string): Block[] {
  return parseBlocks(source.replaceAll('\r\n', '\n').split('\n'));
}
