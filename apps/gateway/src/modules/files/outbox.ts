import { MAX_FILE_BYTES, type MessagePart } from '@aios/contracts';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import nodePath from 'node:path';

/** Berkas per run yang diambil dari folder kiriman, dan batas total ukurannya. */
export const MAX_OUTBOX_FILES = 10;
export const MAX_OUTBOX_BYTES = 50 * 1024 * 1024;
const MAX_DEPTH = 3;

type FilePart = Extract<MessagePart, { type: 'file' }>;

export interface Outbox {
  /** Aturan untuk agent: di mana berkas untuk pemilik disimpan pada run ini. */
  promptFor(runId: string): string;
  /** Berkas yang ditulis agent untuk run ini, disimpan sebagai lampiran; kosong bila tidak ada. */
  collect(runId: string): Promise<FilePart[]>;
}

export interface OutboxDeps {
  /** Folder kiriman seperti terlihat oleh gateway (mis. /outbox, di-mount read-only). */
  dir: string;
  /** Folder yang sama seperti terlihat oleh agent di host (mis. /home/ubuntu/aios-outbox). */
  hostDir: string;
  save: (input: {
    name: string;
    bytes: Buffer;
  }) => Promise<{ id: string; name: string; mime: string }>;
  log?: { warn: (obj: object, msg: string) => void };
}

const RUN_ID = /^[0-9a-f-]{36}$/;

/**
 * Folder kiriman (berkas buatan AI): agent di server menulis berkas untuk pemilik ke `<hostDir>/<runId>/`, lalu
 * gateway mengambilnya saat run selesai dan menempelkannya ke jawaban. Hanya berkas biasa di dalam folder run itu
 * yang diambil: symlink dan path yang keluar folder diabaikan, dengan batas jumlah dan ukuran.
 */
export function createOutbox(deps: OutboxDeps): Outbox {
  const { dir, hostDir, save, log } = deps;

  async function walk(root: string, current: string, depth: number, out: string[]): Promise<void> {
    if (depth > MAX_DEPTH || out.length >= MAX_OUTBOX_FILES) return;
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= MAX_OUTBOX_FILES) return;
      const full = nodePath.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await walk(root, full, depth + 1, out);
      else if (entry.isFile()) out.push(full);
    }
  }

  return {
    promptFor(runId) {
      const folder = `${hostDir.replace(/\/+$/, '')}/${runId}/`;
      return [
        '# Folder kiriman',
        `Bila pemilik meminta berkas jadi yang tidak bisa ditulis sebagai blok kode (zip, PDF, gambar, spreadsheet, dokumen Office), buat berkasnya di folder ${folder} (buat foldernya bila belum ada). Saat jawabanmu selesai, aplikasi menempelkan setiap berkas di folder itu ke jawaban dengan tombol Unduh.`,
        `Hanya folder ${folder} yang dikirim ke pemilik. Maksimal ${MAX_OUTBOX_FILES} berkas, masing-masing maksimal 25 MB. Sebut nama berkasnya di jawaban, bukan path server.`,
      ].join('\n');
    },

    async collect(runId) {
      if (!RUN_ID.test(runId)) return [];
      const runDir = nodePath.join(dir, runId);
      let root: string;
      try {
        root = await realpath(runDir);
      } catch {
        return []; // Agent tidak membuat berkas untuk run ini.
      }
      const found: string[] = [];
      await walk(root, root, 0, found);

      const parts: FilePart[] = [];
      let total = 0;
      for (const path of found) {
        try {
          const resolved = await realpath(path);
          if (!resolved.startsWith(root + nodePath.sep)) continue;
          const stat = await lstat(resolved);
          if (!stat.isFile() || stat.size === 0) continue;
          if (stat.size > MAX_FILE_BYTES || total + stat.size > MAX_OUTBOX_BYTES) {
            log?.warn(
              { runId, path: nodePath.basename(path), size: stat.size },
              'berkas kiriman dilewati: terlalu besar',
            );
            continue;
          }
          const bytes = await readFile(resolved);
          total += bytes.length;
          const saved = await save({ name: nodePath.basename(resolved), bytes });
          parts.push({ type: 'file', fileId: saved.id, name: saved.name, mime: saved.mime });
        } catch (err) {
          log?.warn({ err, runId }, 'berkas kiriman gagal diambil');
        }
      }
      return parts;
    },
  };
}
