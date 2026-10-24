import { inflateRawSync } from 'node:zlib';
import { extractText as extractPdfText, getDocumentProxy } from 'unpdf';

/** Jenis lampiran yang dipahami gateway; selain ini ditolak saat unggah. */
export type FileKind = 'image' | 'pdf' | 'docx' | 'text';

const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const TEXT_MIMES = new Set([
  'application/json',
  'application/xml',
  'application/x-yaml',
  'application/yaml',
  'application/javascript',
  'application/typescript',
  'application/sql',
  'application/toml',
]);
const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'jsonl', 'xml', 'yaml', 'yml', 'toml', 'ini', 'log',
  'html', 'htm', 'css', 'scss', 'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java',
  'kt', 'kts', 'swift', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'sh', 'bash', 'ps1', 'sql', 'graphql', 'vue',
  'svelte', 'dart', 'lua', 'r', 'tex',
]); // prettier-ignore

const extensionOf = (name: string) => name.toLowerCase().split('.').at(-1) ?? '';

/** Jenis berkas dari MIME, dengan ekstensi sebagai cadangan (klien sering mengirim MIME kosong). */
export function classify(name: string, mime: string): FileKind | null {
  const type = mime.toLowerCase().split(';')[0]!.trim();
  const ext = extensionOf(name);
  if (IMAGE_MIMES.has(type)) return 'image';
  if (type === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (type === DOCX_MIME || ext === 'docx') return 'docx';
  if (type.startsWith('text/') || TEXT_MIMES.has(type) || TEXT_EXTENSIONS.has(ext)) return 'text';
  if (!type || type === 'application/octet-stream') {
    if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) return 'image';
  }
  return null;
}

/** MIME gambar yang dipakai saat dikirim ke model (dari ekstensi bila klien tidak mengisinya). */
export function imageMime(name: string, mime: string): string {
  const type = mime.toLowerCase().split(';')[0]!.trim();
  if (IMAGE_MIMES.has(type)) return type;
  const ext = extensionOf(name);
  return ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
}

export class UnreadableFileError extends Error {}

/** Batas isi DOCX yang dibuka (melindungi dari zip bomb). */
const MAX_INFLATED_BYTES = 50 * 1024 * 1024;

/** Teks dari dokumen. Melempar UnreadableFileError bila isinya tidak bisa dibaca. */
export async function extractText(
  kind: Exclude<FileKind, 'image'>,
  bytes: Buffer,
): Promise<string> {
  try {
    if (kind === 'pdf') {
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const { text } = await extractPdfText(pdf, { mergePages: true });
      return text.trim();
    }
    if (kind === 'docx') return docxText(bytes);
    if (bytes.includes(0)) throw new UnreadableFileError('berkas biner');
    return new TextDecoder('utf-8').decode(bytes).trim();
  } catch (err) {
    if (err instanceof UnreadableFileError) throw err;
    throw new UnreadableFileError(err instanceof Error ? err.message : String(err));
  }
}

/** Teks paragraf `word/document.xml` di dalam DOCX (arsip ZIP), tanpa dependensi tambahan. */
export function docxText(bytes: Buffer): string {
  const xml = zipEntry(bytes, 'word/document.xml');
  if (!xml) throw new UnreadableFileError('word/document.xml tidak ada');
  return xml
    .toString('utf8')
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br\/>|<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Membaca satu entri ZIP lewat central directory (metode store atau deflate). */
function zipEntry(zip: Buffer, wanted: string): Buffer | null {
  // End of central directory ada di 22 byte terakhir, atau sebelum komentar (maks 64 KB).
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && offset + 46 <= zip.length; n++) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) return null;
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);
    const name = zip.toString('utf8', offset + 46, offset + 46 + nameLength);
    if (name === wanted) {
      if (zip.readUInt32LE(localOffset) !== 0x04034b50) return null;
      const start =
        localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
      const data = zip.subarray(start, start + compressedSize);
      if (method === 0) return data;
      if (method === 8) return inflateRawSync(data, { maxOutputLength: MAX_INFLATED_BYTES });
      return null;
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}
