import { domainOf } from './select.js';

/**
 * Pemeriksaan rujukan pada laporan Markdown. Model menulis isi dengan [n]; kode di sini yang memastikan
 * nomor sah, menandai klaim tanpa rujukan, menomori ulang menurut kemunculan, dan menyusun daftar sumber
 * (judul dan URL berasal dari data, bukan dari model, jadi tidak bisa dikarang).
 */

export interface Unit {
  text: string;
  section: string;
  /** Indeks baris pertama dan terakhir unit di laporan. */
  start: number;
  end: number;
}

const HEADING = /^#{1,6}\s+(.*)$/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/;
const REF = /\[(\d{1,3})\]/g;
const MIN_FACTUAL_WORDS = 6;
/** Bagian yang memuat catatan metodologi, bukan klaim tentang dunia. */
const META_SECTION = /^(\d+[.)]\s*)?(batasan|ketidakpastian|catatan metodologi|metodologi)/i;

/** `[1, 2]` dan `[1;2]` menjadi `[1][2]`. */
export function normalizeRefs(md: string): string {
  return md.replace(/\[(\d{1,3}(?:\s*[,;]\s*\d{1,3})+)\]/g, (_m, list: string) =>
    list
      .split(/\s*[,;]\s*/)
      .map((n) => `[${n}]`)
      .join(''),
  );
}

/** Memecah laporan menjadi paragraf dan butir daftar (tanpa judul, blok kode, dan baris kosong). */
export function splitUnits(md: string): Unit[] {
  const lines = md.split('\n');
  const units: Unit[] = [];
  let section = '';
  let inCode = false;
  let current: Unit | undefined;
  const flush = () => {
    if (current) units.push(current);
    current = undefined;
  };

  lines.forEach((line, index) => {
    if (line.trimStart().startsWith('```')) {
      flush();
      inCode = !inCode;
      return;
    }
    if (inCode) return;
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      section = (heading[1] ?? '').trim();
      return;
    }
    if (line.trim() === '') return flush();
    if (LIST_ITEM.test(line)) {
      flush();
      current = { text: line.replace(LIST_ITEM, ''), section, start: index, end: index };
      return;
    }
    if (current) {
      current.text += ` ${line.trim()}`;
      current.end = index;
    } else {
      current = { text: line.trim(), section, start: index, end: index };
    }
  });
  flush();
  return units;
}

const wordCount = (text: string) => text.replace(REF, ' ').split(/\s+/).filter(Boolean).length;

/** Klaim faktual = unit cukup panjang di luar bagian catatan metodologi dan bukan baris meta bergaris miring. */
export function isFactual(unit: Unit): boolean {
  if (META_SECTION.test(unit.section)) return false;
  const text = unit.text.trim();
  if (/^_.*_$/.test(text) && !/\[\d{1,3}\]/.test(text)) return false;
  return wordCount(text) >= MIN_FACTUAL_WORDS;
}

export interface CitationCheck {
  /** Nomor rujukan di luar 1..sourceCount. */
  invalid: number[];
  /** Awal teks unit faktual yang tidak punya rujukan sah. */
  uncited: string[];
}

export function checkCitations(md: string, sourceCount: number): CitationCheck {
  const invalid = new Set<number>();
  const uncited: string[] = [];
  for (const unit of splitUnits(normalizeRefs(md))) {
    const refs = [...unit.text.matchAll(REF)].map((m) => Number(m[1]));
    for (const n of refs) if (n < 1 || n > sourceCount) invalid.add(n);
    const valid = refs.some((n) => n >= 1 && n <= sourceCount);
    if (isFactual(unit) && !valid) uncited.push(unit.text.slice(0, 80));
  }
  return { invalid: [...invalid].sort((a, b) => a - b), uncited };
}

export function stripInvalidRefs(md: string, sourceCount: number): string {
  return normalizeRefs(md).replace(REF, (m, n: string) =>
    Number(n) >= 1 && Number(n) <= sourceCount ? m : '',
  );
}

export const UNCITED_MARK = ' _(tanpa rujukan)_';

/** Menandai unit faktual tanpa rujukan secara terbuka. Mengembalikan laporan dan jumlah yang ditandai. */
export function markUncited(md: string, sourceCount: number): { md: string; count: number } {
  const normalized = normalizeRefs(md);
  const lines = normalized.split('\n');
  let count = 0;
  for (const unit of splitUnits(normalized)) {
    const valid = [...unit.text.matchAll(REF)].some(
      (m) => Number(m[1]) >= 1 && Number(m[1]) <= sourceCount,
    );
    if (isFactual(unit) && !valid) {
      lines[unit.end] = `${lines[unit.end] ?? ''}${UNCITED_MARK}`;
      count++;
    }
  }
  return { md: lines.join('\n'), count };
}

/**
 * Menomori ulang rujukan menurut urutan kemunculan pertama (1, 2, 3, ...).
 * `order[i]` adalah nomor asli yang kini menjadi nomor `i + 1`.
 */
export function renumberCitations(md: string): { md: string; order: number[] } {
  const order: number[] = [];
  const mapping = new Map<number, number>();
  for (const m of md.matchAll(REF)) {
    const n = Number(m[1]);
    if (!mapping.has(n)) {
      order.push(n);
      mapping.set(n, order.length);
    }
  }
  return { md: md.replace(REF, (_m, n: string) => `[${mapping.get(Number(n))}]`), order };
}

export interface ListedSource {
  title: string;
  url: string;
  accessedAt: Date;
}

const escapeTitle = (title: string) =>
  title
    .replace(/\s+/g, ' ')
    .replace(/[[\]]/g, (c) => (c === '[' ? '(' : ')'))
    .trim();
const escapeUrl = (url: string) =>
  url.replace(/\s/g, '%20').replace(/\)/g, '%29').replace(/\(/g, '%28');
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/** Daftar sumber: nomor, judul bertautan ke URL, domain, dan tanggal akses. */
export function buildSourceSection(sources: ListedSource[]): string {
  const items = sources.map((s, i) => {
    const title = escapeTitle(s.title) || domainOf(s.url);
    return `- [${i + 1}] [${title}](${escapeUrl(s.url)}) — ${domainOf(s.url)}, diakses ${isoDate(s.accessedAt)}`;
  });
  return `## Daftar sumber\n\n${items.join('\n')}\n`;
}

/** Nama berkas ekspor dari pertanyaan: huruf kecil, tanda hubung, maksimal 6 kata. */
export function reportSlug(question: string): string {
  const slug = question
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .split('-')
    .filter(Boolean)
    .slice(0, 6)
    .join('-');
  return slug || 'riset';
}
