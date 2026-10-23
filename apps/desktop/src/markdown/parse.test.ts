import { describe, expect, it } from 'vitest';
import { parseInlines } from './inline';
import { parseMarkdown } from './parse';

const text = (t: string) => ({ type: 'text', text: t });

describe('parseMarkdown blok', () => {
  it('judul, paragraf, dan garis', () => {
    expect(parseMarkdown('# Judul\n\nIsi satu\nbaris dua\n\n---')).toEqual([
      { type: 'heading', level: 1, inlines: [text('Judul')] },
      { type: 'paragraph', inlines: [text('Isi satu\nbaris dua')] },
      { type: 'rule' },
    ]);
  });

  it('blok kode berpagar menyimpan bahasa dan isi apa adanya', () => {
    const [block] = parseMarkdown('```ts\nconst a = 1;\n\n  indent\n```');
    expect(block).toEqual({
      type: 'code',
      language: 'ts',
      code: 'const a = 1;\n\n  indent',
      closed: true,
    });
  });

  it('pagar yang belum ditutup (streaming) ditandai closed=false', () => {
    const [block] = parseMarkdown('```py\nprint(1)');
    expect(block).toMatchObject({ type: 'code', language: 'py', code: 'print(1)', closed: false });
  });

  it('daftar bersarang menurut indentasi, bernomor dan tidak', () => {
    const [list] = parseMarkdown('1. satu\n   - a\n   - b\n2. dua');
    expect(list).toMatchObject({
      type: 'list',
      ordered: true,
      start: 1,
      items: [
        { inlines: [text('satu')], children: [{ type: 'list', ordered: false }] },
        { inlines: [text('dua')], children: [] },
      ],
    });
    const nested = (list as { items: { children: { items: unknown[] }[] }[] }).items[0]
      ?.children[0];
    expect(nested?.items).toHaveLength(2);
  });

  it('kutipan berisi blok', () => {
    expect(parseMarkdown('> kutipan\n> dua')).toEqual([
      { type: 'quote', blocks: [{ type: 'paragraph', inlines: [text('kutipan\ndua')] }] },
    ]);
  });

  it('tabel dengan header, pemisah, dan baris', () => {
    const [table] = parseMarkdown('| A | B |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |');
    expect(table).toEqual({
      type: 'table',
      header: [[text('A')], [text('B')]],
      rows: [
        [[text('1')], [text('2')]],
        [[text('3')], [text('4')]],
      ],
    });
  });

  it('baris dengan | tanpa pemisah tetap paragraf', () => {
    expect(parseMarkdown('a | b')).toEqual([{ type: 'paragraph', inlines: [text('a | b')] }]);
  });

  it('CRLF diperlakukan seperti LF dan masukan kosong menghasilkan daftar kosong', () => {
    expect(parseMarkdown('a\r\n\r\nb')).toHaveLength(2);
    expect(parseMarkdown('')).toEqual([]);
  });
});

describe('parseInlines', () => {
  it('tebal, miring, coret, dan kode', () => {
    expect(parseInlines('**t** *m* ~~c~~ `k`')).toEqual([
      { type: 'bold', children: [text('t')] },
      text(' '),
      { type: 'italic', children: [text('m')] },
      text(' '),
      { type: 'strike', children: [text('c')] },
      text(' '),
      { type: 'code', code: 'k' },
    ]);
  });

  it('tautan hanya untuk http, https, dan mailto', () => {
    expect(parseInlines('[ok](https://a.com) [bad](javascript:alert(1))')).toEqual([
      { type: 'link', children: [text('ok')], url: 'https://a.com' },
      text(' [bad](javascript:alert(1))'),
    ]);
  });

  it('URL telanjang tidak membawa tanda baca penutup', () => {
    expect(parseInlines('lihat https://a.com/x.')).toEqual([
      text('lihat '),
      { type: 'link', children: [text('https://a.com/x')], url: 'https://a.com/x' },
      text('.'),
    ]);
  });

  it('garis bawah di dalam kata bukan penekanan; escape dihormati', () => {
    expect(parseInlines('snake_case_name')).toEqual([text('snake_case_name')]);
    expect(parseInlines('\\*bukan\\*')).toEqual([text('*bukan*')]);
  });

  it('penanda yang tidak berpasangan tetap teks', () => {
    expect(parseInlines('2 * 3 = 6 dan `kode')).toEqual([text('2 * 3 = 6 dan `kode')]);
  });

  it('HTML mentah tetap teks biasa', () => {
    expect(parseInlines('<script>x</script>')).toEqual([text('<script>x</script>')]);
  });
});
