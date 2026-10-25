import { describe, expect, it } from 'vitest';
import { buildZip, crc32, extractCodeFiles, safePath } from './codeArchive';

const answer = [
  'Berikut project-nya:',
  '```json package.json',
  '{ "name": "todo" }',
  '```',
  '```jsx title="src/App.jsx"',
  'export default function App() {}',
  '```',
  '```css',
  '/* src/index.css */',
  'body { margin: 0; }',
  '```',
  '```bash',
  'npm install',
  '```',
  '```bash',
  'npm run dev',
  '```',
].join('\n');

describe('extractCodeFiles', () => {
  it('nama dari baris pembuka, atribut title, komentar baris pertama, lalu nama bawaan unik', () => {
    expect(extractCodeFiles(answer).map((f) => f.path)).toEqual([
      'package.json',
      'src/App.jsx',
      'src/index.css',
      'berkas-4.sh',
      'berkas-5.sh',
    ]);
  });

  it('isi berkas utuh dan diakhiri baris baru; blok kosong dilewati', () => {
    const files = extractCodeFiles('```js a.js\nconst x = 1;\n```\n```\n\n```');
    expect(files).toEqual([{ path: 'a.js', content: 'const x = 1;\n' }]);
  });

  it('nama yang sama mendapat akhiran agar tidak saling menimpa', () => {
    const files = extractCodeFiles('```js app.js\n1\n```\n```js app.js\n2\n```');
    expect(files.map((f) => f.path)).toEqual(['app.js', 'app-2.js']);
  });

  it('tanpa blok kode: kosong', () => {
    expect(extractCodeFiles('Hanya teks biasa.')).toEqual([]);
  });
});

describe('safePath', () => {
  it('tidak bisa keluar dari folder zip', () => {
    expect(safePath('../../etc/passwd')).toBe('etc/passwd');
    expect(safePath('/abs/x.js')).toBe('abs/x.js');
    expect(safePath('src\\App.jsx')).toBe('src/App.jsx');
  });
});

describe('buildZip', () => {
  it('CRC32 sesuai nilai rujukan', () => {
    expect(crc32(new TextEncoder().encode('hello'))).toBe(0x3610a686);
  });

  it('struktur ZIP: header lokal, central directory, dan end record dengan jumlah berkas', () => {
    const zip = buildZip([
      { path: 'a.txt', content: 'A\n' },
      { path: 'src/b.js', content: 'B\n' },
    ]);
    const view = new DataView(zip.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    const end = zip.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
    const centralStart = view.getUint32(end + 16, true);
    expect(view.getUint32(centralStart, true)).toBe(0x02014b50);
  });
});
