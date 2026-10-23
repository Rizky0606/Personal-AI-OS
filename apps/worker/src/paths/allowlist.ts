import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import nodePath from 'node:path';
import { z } from 'zod';
import { PathError, assertDirectory, canonicalize, isInside } from './normalize.js';

const FileSchema = z.object({ version: z.literal(1), folders: z.array(z.string().min(1)) });

export interface AllowListOptions {
  /** Berkas JSON penyimpanan; dibuat saat folder pertama ditambahkan. */
  file: string;
  /** Folder yang tidak boleh diizinkan (selain root drive). Default: folder home pengguna dan leluhurnya. */
  forbidden?: string[];
}

/**
 * Daftar folder yang boleh disentuh worker (SECURITY_OPS.md, "Worker dan eksekusi"). Semua pemeriksaan
 * memakai path kanonik (symlink diselesaikan), jadi `..`, symlink, dan junction tidak bisa keluar dari akar.
 */
export class AllowList {
  private folders: string[] = [];
  private readonly forbidden: string[];

  constructor(private readonly options: AllowListOptions) {
    this.forbidden = options.forbidden ?? [homedir()];
  }

  async load(): Promise<void> {
    let text: string;
    try {
      text = await fs.readFile(this.options.file, 'utf8');
    } catch {
      this.folders = [];
      return;
    }
    const parsed = FileSchema.safeParse(safeJson(text));
    if (!parsed.success) {
      // Berkas rusak: simpan salinannya untuk diperiksa, mulai kosong (gagal tertutup, bukan terbuka).
      await fs.rename(this.options.file, `${this.options.file}.bad`).catch(() => undefined);
      this.folders = [];
      return;
    }
    this.folders = parsed.data.folders;
  }

  list(): string[] {
    return [...this.folders];
  }

  /** Menambah folder. Menolak root drive, folder home (dan leluhurnya), dan yang bukan folder. */
  async add(input: string): Promise<string> {
    const real = await canonicalize(input);
    await assertDirectory(real);
    if (nodePath.parse(real).root === real || (await this.isForbidden(real))) {
      throw new PathError(
        'path_too_broad',
        'Folder ini terlalu luas. Pilih folder project, bukan drive atau folder home.',
      );
    }
    if (!this.folders.some((f) => sameFolder(f, real))) {
      this.folders.push(real);
      await this.save();
    }
    return real;
  }

  async remove(input: string): Promise<void> {
    // Tidak memakai canonicalize: folder yang sudah dihapus dari disk tetap harus bisa dicabut izinnya.
    const target = nodePath.resolve(input);
    const next = this.folders.filter((f) => !sameFolder(f, target));
    if (next.length !== this.folders.length) {
      this.folders = next;
      await this.save();
    }
  }

  /**
   * Mengembalikan path kanonik bila berada di dalam salah satu folder izin; selain itu melempar
   * `path_not_allowed`. Identitas akar diperiksa ulang tiap pemeriksaan (lihat di bawah).
   */
  async resolve(input: string): Promise<string> {
    const real = await canonicalize(input);
    for (const root of this.folders) {
      // Akar tersimpan sudah kanonik. Bila sekarang menyelesaikan ke tempat lain (diganti junction/symlink),
      // izinnya tidak berlaku lagi, bukan ikut berpindah ke tujuan baru.
      const current = await canonicalize(root).catch(() => undefined);
      if (current && sameFolder(current, root) && isInside(root, real)) return real;
    }
    throw new PathError(
      'path_not_allowed',
      'Folder ini belum diizinkan. Tambahkan di Pengaturan, bagian Folder yang diizinkan.',
    );
  }

  /** Seperti [resolve] tetapi harus folder yang ada. */
  async resolveDirectory(input: string): Promise<string> {
    const real = await this.resolve(input);
    await assertDirectory(real);
    return real;
  }

  private async isForbidden(real: string): Promise<boolean> {
    for (const item of this.forbidden) {
      const blocked = await canonicalize(item).catch(() => undefined);
      // Folder terlarang itu sendiri, atau leluhurnya (mengizinkan leluhur = mengizinkan seluruh home).
      if (blocked && isInside(real, blocked)) return true;
    }
    return false;
  }

  private async save(): Promise<void> {
    await fs.mkdir(nodePath.dirname(this.options.file), { recursive: true });
    const temp = `${this.options.file}.tmp`;
    await fs.writeFile(temp, JSON.stringify({ version: 1, folders: this.folders }, null, 2));
    await fs.rename(temp, this.options.file);
  }
}

function sameFolder(a: string, b: string): boolean {
  return isInside(a, b) && isInside(b, a);
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
