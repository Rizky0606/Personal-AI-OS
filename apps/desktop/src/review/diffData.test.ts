import { describe, expect, it } from 'vitest';
import { highlightLine, languageOf } from './highlight';
import { parsePatch, toSplitRows } from './parsePatch';

const PATCH = [
  'diff --git a/math.js b/math.js',
  'index 111..222 100644',
  '--- a/math.js',
  '+++ b/math.js',
  '@@ -1,4 +1,5 @@',
  ' const a = 1;',
  '-const b = 2;',
  '-const c = 3;',
  '+const b = 20;',
  ' export {};',
  '+// baru',
  '\\ No newline at end of file',
  '@@ -40,2 +41,2 @@ function lama()',
  ' x',
  '-y',
  '+z',
  '',
].join('\n');

describe('parsePatch', () => {
  it('memberi nomor baris lama dan baru per hunk; header berkas dan penanda "No newline" dilewati', () => {
    const hunks = parsePatch(PATCH);

    expect(hunks.map((h) => h.header)).toEqual([
      '@@ -1,4 +1,5 @@',
      '@@ -40,2 +41,2 @@ function lama()',
    ]);
    expect(hunks[0]?.lines.map((l) => [l.kind, l.oldNo, l.newNo, l.text])).toEqual([
      ['ctx', 1, 1, 'const a = 1;'],
      ['del', 2, null, 'const b = 2;'],
      ['del', 3, null, 'const c = 3;'],
      ['add', null, 2, 'const b = 20;'],
      ['ctx', 4, 3, 'export {};'],
      ['add', null, 4, '// baru'],
    ]);
    expect(hunks[1]?.lines.map((l) => [l.kind, l.oldNo, l.newNo])).toEqual([
      ['ctx', 40, 41],
      ['del', 41, null],
      ['add', null, 42],
    ]);
  });

  it('baris hapus yang isinya diawali "--" tidak dianggap header', () => {
    const hunks = parsePatch('@@ -1,2 +1,1 @@\n--- komentar sql\n-- lama\n+baru\n');

    expect(hunks[0]?.lines.map((l) => [l.kind, l.text])).toEqual([
      ['del', '-- komentar sql'],
      ['del', '- lama'],
      ['add', 'baru'],
    ]);
  });

  it('patch kosong atau biner: tidak ada hunk; CRLF dibersihkan', () => {
    expect(parsePatch('')).toEqual([]);
    expect(parsePatch('Binary files a/x.png and b/x.png differ\n')).toEqual([]);
    expect(parsePatch('@@ -1 +1 @@\r\n-a\r\n+b\r\n')[0]?.lines.map((l) => l.text)).toEqual([
      'a',
      'b',
    ]);
  });
});

describe('toSplitRows', () => {
  it('rangkaian hapus dipasangkan dengan rangkaian tambah; konteks di kedua sisi', () => {
    const rows = toSplitRows(parsePatch(PATCH)[0]!);

    expect(rows.map((r) => [r.left?.text ?? null, r.right?.text ?? null])).toEqual([
      ['const a = 1;', 'const a = 1;'],
      ['const b = 2;', 'const b = 20;'],
      ['const c = 3;', null],
      ['export {};', 'export {};'],
      [null, '// baru'],
    ]);
  });
});

describe('highlight', () => {
  it('bahasa dari ekstensi', () => {
    expect(languageOf('src/a.tsx')).toBe('typescript');
    expect(languageOf('Cargo.toml')).toBe('ini');
    expect(languageOf('LICENSE')).toBeUndefined();
    expect(languageOf('a.unknown')).toBeUndefined();
  });

  it('kata kunci diberi kelas; teks tetap utuh dan di-escape', () => {
    const html = highlightLine('const x = "<b>" && 1;', 'typescript');

    expect(html).toContain('<span class="hljs-keyword">const</span>');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;b&gt;');
  });

  it('tanpa bahasa: hanya di-escape', () => {
    expect(highlightLine('a < b && c', undefined)).toBe('a &lt; b &amp;&amp; c');
  });
});
