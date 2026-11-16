import type { CreateMemoryRequestSchema, Memory, UpdateMemoryRequestSchema } from '@aios/contracts';
import { asc, count, eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { Database } from '../../db/client.js';
import { memories } from '../../db/schema/index.js';
import { AppError } from '../../errors.js';
import { createMemoryRecaller, type MemoryRecall, type RecallSelection } from './recall.js';

/** Batas jumlah memori: daftar yang dikelola pemilik harus tetap ringkas. */
export const MAX_MEMORIES = 200;

export interface MemoryService {
  list(): Promise<Memory[]>;
  create(input: z.infer<typeof CreateMemoryRequestSchema>): Promise<Memory>;
  update(id: string, patch: z.infer<typeof UpdateMemoryRequestSchema>): Promise<Memory>;
  remove(id: string): Promise<void>;
  /**
   * Memori untuk satu pesan: bagian pesan sistem dan ringkasannya untuk event `context.used` (jumlah, cara
   * pemilihan, judul singkat; bukan isinya). Dihitung per run supaya perubahan dari aplikasi langsung berlaku pada
   * pesan berikutnya. Isi lengkap tidak pernah keluar dari sini selain lewat `section`.
   */
  recall(input: { text: string }): Promise<MemoryRecall>;
  /**
   * Pemilihan memori aktif untuk satu teks (anggaran dan urutan yang sama dengan `recall`: tersemat, cocok kata,
   * terbaru), beserta jumlah memori aktif. Dipakai tool `memory_list`.
   */
  select(text: string): Promise<RecallSelection & { total: number }>;
}

const columns = {
  id: memories.id,
  text: memories.text,
  enabled: memories.enabled,
  pinned: memories.pinned,
  createdAt: memories.createdAt,
  updatedAt: memories.updatedAt,
};

type MemoryRow = Pick<typeof memories.$inferSelect, keyof typeof columns>;

const toMemoryDto = (row: MemoryRow): Memory => ({
  id: row.id,
  text: row.text,
  enabled: row.enabled,
  pinned: row.pinned,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const notFound = () => new AppError(404, 'memory_not_found', 'Memori tidak ditemukan.');

export function createMemoryService(deps: {
  db: Database;
  /** Anggaran baris fakta di pesan sistem (karakter) dan maks fakta cocok kata; bawaan di recall.ts. */
  recallBudgetChars?: number | undefined;
  recallTopK?: number | undefined;
  log?: { warn: (obj: object, msg: string) => void } | undefined;
}): MemoryService {
  const { db } = deps;
  const recaller = createMemoryRecaller({
    db,
    budgetChars: deps.recallBudgetChars,
    topK: deps.recallTopK,
    log: deps.log,
  });

  return {
    async list() {
      const rows = await db
        .select(columns)
        .from(memories)
        .orderBy(asc(memories.createdAt), asc(memories.id));
      return rows.map(toMemoryDto);
    },

    async create({ text, pinned }) {
      const [total] = await db.select({ n: count() }).from(memories);
      if ((total?.n ?? 0) >= MAX_MEMORIES) {
        throw new AppError(
          409,
          'memory_limit',
          `Memori sudah ${MAX_MEMORIES}. Hapus yang tidak dipakai sebelum menambah yang baru.`,
        );
      }
      const [row] = await db
        .insert(memories)
        .values({ text, ...(pinned !== undefined ? { pinned } : {}) })
        .returning(columns);
      return toMemoryDto(row!);
    },

    async update(id, patch) {
      const [row] = await db
        .update(memories)
        .set({
          ...(patch.text !== undefined ? { text: patch.text } : {}),
          ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
          ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
        })
        .where(eq(memories.id, id))
        .returning(columns);
      if (!row) throw notFound();
      return toMemoryDto(row);
    },

    async remove(id) {
      const deleted = await db
        .delete(memories)
        .where(eq(memories.id, id))
        .returning({ id: memories.id });
      if (!deleted.length) throw notFound();
    },

    recall: (input) => recaller.recall(input),
    select: (text) => recaller.select(text),
  };
}
