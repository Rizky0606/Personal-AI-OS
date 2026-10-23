export type Inline =
  | { type: 'text'; text: string }
  | { type: 'code'; code: string }
  | { type: 'bold'; children: Inline[] }
  | { type: 'italic'; children: Inline[] }
  | { type: 'strike'; children: Inline[] }
  | { type: 'link'; children: Inline[]; url: string };

const SAFE_SCHEMES = ['http://', 'https://', 'mailto:'];
const TRAILING = '.,;:!?\'"]';
const ESCAPABLE = '\\`*_{}[]()#+-.!~|<>';

const isSpace = (c: string | undefined): boolean => c !== undefined && /\s/.test(c);
const isAlnum = (c: string | undefined): boolean => c !== undefined && /[\p{L}\p{N}]/u.test(c);
const hasSafeScheme = (url: string): boolean =>
  SAFE_SCHEMES.some((scheme) => url.toLowerCase().startsWith(scheme));

function findBacktickClose(s: string, from: number, n: number): number {
  let k = from;
  while (k < s.length) {
    if (s[k] === '`') {
      let run = 0;
      while (s[k + run] === '`') run++;
      if (run === n) return k;
      k += run;
    } else {
      k++;
    }
  }
  return -1;
}

/** Mengembalikan jumlah karakter yang dikonsumsi, atau 0 bila bukan penekanan yang sah. */
function emphasis(s: string, i: number, out: Inline[], flush: () => void): number {
  const ch = s[i]!;
  let k = 0;
  while (s[i + k] === ch) k++;
  if (k > 3) return 0;
  const after = i + k;
  if (after >= s.length || isSpace(s[after])) return 0;
  if (ch === '_' && i > 0 && isAlnum(s[i - 1])) return 0;
  const delim = ch.repeat(k);
  let close = s.indexOf(delim, after);
  while (close >= 0) {
    const validClose =
      close > after &&
      !isSpace(s[close - 1]) &&
      (ch !== '_' || close + k >= s.length || !isAlnum(s[close + k])) &&
      (close + k >= s.length || s[close + k] !== ch);
    if (validClose) break;
    close = s.indexOf(delim, close + 1);
  }
  if (close < 0) return 0;
  const inner = parseInlines(s.slice(after, close));
  flush();
  if (k === 1) out.push({ type: 'italic', children: inner });
  else if (k === 2) out.push({ type: 'bold', children: inner });
  else out.push({ type: 'bold', children: [{ type: 'italic', children: inner }] });
  return close + k - i;
}

interface LinkMatch {
  text: string;
  url: string;
  end: number;
}

function linkAt(s: string, i: number): LinkMatch | null {
  let depth = 0;
  let k = i;
  while (k < s.length) {
    if (s[k] === '[') depth++;
    else if (s[k] === ']') {
      depth--;
      if (depth === 0) break;
    }
    k++;
  }
  if (k + 1 >= s.length || s[k + 1] !== '(') return null;
  const close = s.indexOf(')', k + 2);
  if (close < 0) return null;
  const url = (
    s
      .slice(k + 2, close)
      .trim()
      .split(' ')[0] ?? ''
  ).trim();
  if (!hasSafeScheme(url)) return null;
  return { text: s.slice(i + 1, k), url, end: close + 1 };
}

function isAutolink(s: string, i: number): boolean {
  const end = s.indexOf('>', i);
  if (end < 0) return false;
  const inner = s.slice(i + 1, end);
  return !/\s/.test(inner) && hasSafeScheme(inner);
}

function startsUrl(s: string, i: number): boolean {
  return (
    (s.startsWith('https://', i) || s.startsWith('http://', i)) && (i === 0 || !isAlnum(s[i - 1]))
  );
}

function bareUrl(s: string, i: number): string {
  let end = i;
  while (end < s.length && !isSpace(s[end]) && s[end] !== '<') end++;
  let url = s.slice(i, end);
  while (url.length > 0) {
    const last = url[url.length - 1]!;
    const count = (c: string) => url.split(c).length - 1;
    const unbalancedParen = last === ')' && count(')') > count('(');
    if (TRAILING.includes(last) || unbalancedParen) url = url.slice(0, -1);
    else break;
  }
  return url;
}

/** Inline: tebal, miring, coret, kode, tautan http/https/mailto. Masukan belum selesai tetap menghasilkan keluaran wajar. */
export function parseInlines(s: string): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  const flush = () => {
    if (buf) {
      out.push({ type: 'text', text: buf });
      buf = '';
    }
  };

  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (c === '\\' && i + 1 < s.length && ESCAPABLE.includes(s[i + 1]!)) {
      buf += s[i + 1];
      i += 2;
    } else if (c === '`') {
      let n = 0;
      while (s[i + n] === '`') n++;
      const close = findBacktickClose(s, i + n, n);
      if (close < 0) {
        buf += '`'.repeat(n);
        i += n;
      } else {
        flush();
        let code = s.slice(i + n, close);
        if (code.length >= 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim()) {
          code = code.slice(1, -1);
        }
        out.push({ type: 'code', code });
        i = close + n;
      }
    } else if (c === '~' && s.startsWith('~~', i)) {
      const close = s.indexOf('~~', i + 2);
      if (close > i + 2 && !isSpace(s[i + 2])) {
        flush();
        out.push({ type: 'strike', children: parseInlines(s.slice(i + 2, close)) });
        i = close + 2;
      } else {
        buf += '~~';
        i += 2;
      }
    } else if (c === '*' || c === '_') {
      const consumed = emphasis(s, i, out, flush);
      if (consumed > 0) {
        i += consumed;
      } else {
        buf += c;
        i++;
      }
    } else if (c === '[') {
      const link = linkAt(s, i);
      if (link) {
        flush();
        out.push({ type: 'link', children: parseInlines(link.text), url: link.url });
        i = link.end;
      } else {
        buf += c;
        i++;
      }
    } else if (c === '<' && isAutolink(s, i)) {
      const end = s.indexOf('>', i);
      flush();
      const url = s.slice(i + 1, end);
      out.push({ type: 'link', children: [{ type: 'text', text: url }], url });
      i = end + 1;
    } else if (c === 'h' && startsUrl(s, i)) {
      const url = bareUrl(s, i);
      flush();
      out.push({ type: 'link', children: [{ type: 'text', text: url }], url });
      i += url.length;
    } else {
      buf += c;
      i++;
    }
  }
  flush();
  return out;
}
