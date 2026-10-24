import { MAX_FILE_BYTES, type FileRecord, type MessagePartInput } from '@aios/contracts';
import { createHash } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { files } from '../../db/schema/index.js';
import { AppError } from '../../errors.js';
import { classify, extractText, imageMime, UnreadableFileError } from './extract.js';

/** Gambar dikirim inline (base64) ke model; batas ini menjaga request tetap wajar bagi provider. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** Lampiran per pesan. */
export const MAX_FILES_PER_MESSAGE = 10;
/** Teks per dokumen yang diteruskan ke agent; sisanya dipotong dengan catatan. */
export const MAX_DOCUMENT_CHARS = 60_000;

/** Lampiran pesan yang sudah disiapkan untuk agent. */
export interface PreparedAttachments {
  /** Part `file` dengan nama dan MIME dari database (bukan dari klien). */
  parts: Extract<MessagePartInput, { type: 'file' }>[];
  /** Isi dokumen sebagai teks, ditambahkan ke prompt. Kosong bila tidak ada dokumen. */
  documents: string;
  /** Gambar untuk model vision. */
  images: { mime: string; data: string }[];
}

export interface FilesService {
  save(input: { name: string; mime: string; bytes: Buffer }): Promise<FileRecord>;
  /** Membaca lampiran pesan dari database: dokumen menjadi teks, gambar menjadi base64. */
  prepare(parts: readonly MessagePartInput[]): Promise<PreparedAttachments>;
}

const unsupported = () =>
  new AppError(
    400,
    'unsupported_file_type',
    'Jenis berkas belum didukung. Kirim gambar (PNG, JPEG, WebP, GIF), PDF, DOCX, atau berkas teks.',
  );
const unreadable = (name: string) =>
  new AppError(
    400,
    'file_unreadable',
    `Isi "${name}" tidak bisa dibaca. Periksa berkasnya lalu coba lagi.`,
  );

/** Nama tampilan: tanpa path, tanpa karakter kontrol, maks 200 karakter. */
function cleanName(raw: string): string {
  const base = raw.split(/[\\/]/).at(-1) ?? '';
  const name = base
    // eslint-disable-next-line no-control-regex -- karakter kontrol memang yang dibuang
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 200);
  return name || 'lampiran';
}

export function createFilesService(deps: { db: Database }): FilesService {
  const { db } = deps;

  return {
    async save({ name: rawName, mime: rawMime, bytes }) {
      const name = cleanName(rawName);
      if (bytes.length === 0) throw new AppError(400, 'file_empty', 'Berkas kosong.');
      if (bytes.length > MAX_FILE_BYTES) {
        throw new AppError(413, 'file_too_large', 'Berkas melebihi 25 MB.');
      }
      const kind = classify(name, rawMime);
      if (!kind) throw unsupported();
      const mime =
        kind === 'image' ? imageMime(name, rawMime) : rawMime || 'application/octet-stream';
      if (kind === 'image' && bytes.length > MAX_IMAGE_BYTES) {
        throw new AppError(
          413,
          'image_too_large',
          'Gambar melebihi 10 MB. Kecilkan dulu lalu kirim lagi.',
        );
      }
      // Dokumen dibaca sekarang, supaya berkas rusak ditolak saat diunggah, bukan saat pesan dikirim.
      if (kind !== 'image') {
        try {
          await extractText(kind, bytes);
        } catch (err) {
          if (err instanceof UnreadableFileError) throw unreadable(name);
          throw err;
        }
      }
      const [row] = await db
        .insert(files)
        .values({
          name,
          mime,
          size: bytes.length,
          content: bytes,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        })
        .returning({
          id: files.id,
          name: files.name,
          mime: files.mime,
          size: files.size,
          sha256: files.sha256,
          createdAt: files.createdAt,
        });
      return { ...row!, createdAt: row!.createdAt.toISOString() };
    },

    async prepare(parts) {
      const wanted = parts.flatMap((p) => (p.type === 'file' ? [p.fileId] : []));
      if (wanted.length === 0) return { parts: [], documents: '', images: [] };
      if (wanted.length > MAX_FILES_PER_MESSAGE) {
        throw new AppError(
          400,
          'too_many_files',
          `Maksimal ${MAX_FILES_PER_MESSAGE} lampiran per pesan.`,
        );
      }
      const rows = await db.select().from(files).where(inArray(files.id, wanted));
      const byId = new Map(rows.map((r) => [r.id, r]));

      const prepared: PreparedAttachments = { parts: [], documents: '', images: [] };
      const blocks: string[] = [];
      for (const id of wanted) {
        const row = byId.get(id);
        if (!row)
          throw new AppError(400, 'file_not_found', 'Lampiran tidak ditemukan. Unggah ulang.');
        prepared.parts.push({ type: 'file', fileId: row.id, name: row.name, mime: row.mime });
        const kind = classify(row.name, row.mime);
        if (kind === 'image') {
          prepared.images.push({ mime: row.mime, data: row.content.toString('base64') });
          continue;
        }
        if (!kind) throw unsupported();
        let text: string;
        try {
          text = await extractText(kind, row.content);
        } catch (err) {
          if (err instanceof UnreadableFileError) throw unreadable(row.name);
          throw err;
        }
        const cut = text.length > MAX_DOCUMENT_CHARS;
        blocks.push(
          [
            `<lampiran nama="${row.name.replace(/"/g, "'")}">`,
            cut ? text.slice(0, MAX_DOCUMENT_CHARS) : text || '(dokumen tanpa teks)',
            cut ? `[dipotong: hanya ${MAX_DOCUMENT_CHARS} karakter pertama]` : '',
            '</lampiran>',
          ]
            .filter(Boolean)
            .join('\n'),
        );
      }
      prepared.documents = blocks.join('\n\n');
      return prepared;
    },
  };
}
