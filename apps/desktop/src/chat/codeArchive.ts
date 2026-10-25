/**
 * Mengemas blok kode di jawaban AI menjadi berkas ZIP (tombol Unduh ZIP). Nama berkas diambil dari baris pembuka
 * blok (```jsx src/App.jsx atau title="src/App.jsx"), lalu komentar path di baris pertama kode, lalu nama bawaan
 * dari bahasanya. ZIP ditulis sendiri (metode store, CRC32, nama UTF-8) tanpa dependensi.
 */

export interface CodeFile {
  path: string;
  content: string;
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;

const EXTENSIONS: Record<string, string> = {
  js: 'js',
  javascript: 'js',
  jsx: 'jsx',
  ts: 'ts',
  typescript: 'ts',
  tsx: 'tsx',
  py: 'py',
  python: 'py',
  html: 'html',
  css: 'css',
  scss: 'scss',
  json: 'json',
  md: 'md',
  markdown: 'md',
  sh: 'sh',
  bash: 'sh',
  shell: 'sh',
  zsh: 'sh',
  ps1: 'ps1',
  powershell: 'ps1',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  sql: 'sql',
  java: 'java',
  kotlin: 'kt',
  kt: 'kt',
  go: 'go',
  rust: 'rs',
  rs: 'rs',
  c: 'c',
  cpp: 'cpp',
  cs: 'cs',
  php: 'php',
  rb: 'rb',
  ruby: 'rb',
  swift: 'swift',
  dart: 'dart',
  vue: 'vue',
  svelte: 'svelte',
  xml: 'xml',
  dockerfile: 'Dockerfile',
  env: 'env',
};

const looksLikePath = (token: string) =>
  /^[\w@~./\\-]+\.[A-Za-z0-9]{1,10}$|^Dockerfile$|^Makefile$/.test(token);

/** Path aman di dalam zip: garis miring maju, tanpa awalan "/" atau segmen "..". */
export function safePath(raw: string): string {
  const parts = raw
    .replace(/\\/g, '/')
    .split('/')
    .filter((p) => p && p !== '.' && p !== '..');
  return parts.join('/');
}

function pathFromInfo(info: string): string | null {
  const attr = /(?:title|file|filename|path)\s*=\s*["']?([^"'\s]+)/i.exec(info);
  if (attr?.[1]) return attr[1];
  const tokens = info.trim().split(/\s+/).slice(1);
  return tokens.find(looksLikePath) ?? null;
}

function pathFromFirstLine(code: string): string | null {
  const first = code.split('\n', 1)[0]?.trim() ?? '';
  const m = /^(?:\/\/|#|--|;)\s*(\S+)\s*$|^\/\*\s*(\S+)\s*\*\/$|^<!--\s*(\S+)\s*-->$/.exec(first);
  const candidate = m?.[1] ?? m?.[2] ?? m?.[3];
  return candidate && looksLikePath(candidate) ? candidate : null;
}

/** Semua blok kode berpagar di teks Markdown, beserta nama berkasnya (unik). */
export function extractCodeFiles(markdown: string): CodeFile[] {
  const lines = markdown.split('\n');
  const files: CodeFile[] = [];
  const used = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const open = FENCE_OPEN.exec(lines[i]!);
    if (!open) continue;
    const fence = open[1]!;
    const info = open[2] ?? '';
    const body: string[] = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const t = lines[j]!.trim();
      if (t.length >= fence.length && [...t].every((ch) => ch === fence[0])) break;
      body.push(lines[j]!);
    }
    i = j;
    const content = body.join('\n');
    if (!content.trim()) continue;

    const language = info.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
    const named = pathFromInfo(info) ?? pathFromFirstLine(content);
    let path = named ? safePath(named) : '';
    if (!path) {
      const ext = EXTENSIONS[language] ?? 'txt';
      path = ext === 'Dockerfile' ? 'Dockerfile' : `berkas-${files.length + 1}.${ext}`;
    }
    // Nama sama (mis. dua blok tanpa path dengan bahasa sama): beri akhiran -2, -3, ...
    let unique = path;
    for (let n = 2; used.has(unique); n++) unique = path.replace(/(\.[^./]+)?$/, `-${n}$1`);
    used.add(unique);
    files.push({ path: unique, content: content.endsWith('\n') ? content : `${content}\n` });
  }
  return files;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** ZIP (metode store) berisi berkas-berkas ini; nama ditandai UTF-8 (bit 11) agar karakter non-ASCII aman. */
export function buildZip(files: readonly CodeFile[], now = new Date()): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.path);
    const data = encoder.encode(file.content);
    const crc = crc32(data);

    const local = new Uint8Array(30 + name.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // versi yang dibutuhkan
    lv.setUint16(6, 0x0800, true); // nama UTF-8
    lv.setUint16(8, 0, true); // store
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);

    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }

  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const out = new Uint8Array(offset + centralSize + end.length);
  let at = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
