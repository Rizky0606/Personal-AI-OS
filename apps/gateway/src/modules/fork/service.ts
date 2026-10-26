import type { Conversation } from '@aios/contracts';
import { TERMINAL_RUN_STATUSES } from '@aios/contracts';
import { and, asc, eq, lte, notInArray } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { conversations, messages, runs } from '../../db/schema/index.js';
import { AppError } from '../../errors.js';
import { uuidv7 } from '../../lib/uuidv7.js';
import { toConversationDto } from '../chat/dto.js';

/** Batas pesan yang disalin ke cabang; riwayat yang lebih panjang tidak dipotong tetapi ditolak jelas. */
export const MAX_FORK_MESSAGES = 500;

export interface ForkService {
  /** Percakapan baru berisi pesan sampai `messageId` (termasuk); percakapan asal tidak berubah. */
  fork(messageId: string): Promise<Conversation>;
}

/**
 * Cabang percakapan (W31): menyalin pesan dari awal sampai pesan yang dipilih ke percakapan baru di project dan
 * ruang yang sama, supaya jalur lain bisa dicoba tanpa menghapus yang lama. Agent di cabang memulai sesi baru
 * dengan riwayat salinan itu. Run tidak ikut disalin, jadi pesan salinan tidak merujuk run.
 */
export function createForkService(deps: { db: Database }): ForkService {
  const { db } = deps;

  return {
    async fork(messageId) {
      const [target] = await db.select().from(messages).where(eq(messages.id, messageId));
      if (!target) throw new AppError(404, 'message_not_found', 'Pesan tidak ditemukan.');
      if (target.author === 'system') {
        throw new AppError(
          409,
          'message_not_forkable',
          'Percakapan hanya bisa dicabangkan dari pesan pengguna atau asisten.',
        );
      }
      const [source] = await db
        .select()
        .from(conversations)
        .where(eq(conversations.id, target.conversationId));
      if (!source) throw new AppError(404, 'conversation_not_found', 'Percakapan tidak ditemukan.');

      // Jawaban yang belum selesai (teksnya masih mengalir) belum bisa dijadikan titik cabang.
      if (target.runId) {
        const [run] = await db
          .select({ id: runs.id })
          .from(runs)
          .where(
            and(
              eq(runs.id, target.runId),
              notInArray(runs.status, [...TERMINAL_RUN_STATUSES, 'needs_review']),
            ),
          );
        if (run && target.author === 'assistant') {
          throw new AppError(
            409,
            'run_active',
            'Jawaban ini masih berjalan. Tunggu selesai sebelum mencabangkan.',
          );
        }
      }

      const rows = await db
        .select()
        .from(messages)
        .where(and(eq(messages.conversationId, source.id), lte(messages.id, target.id)))
        .orderBy(asc(messages.id));
      if (rows.length > MAX_FORK_MESSAGES) {
        throw new AppError(
          409,
          'fork_too_long',
          `Riwayat terlalu panjang untuk dicabangkan (maks ${MAX_FORK_MESSAGES} pesan). Pakai Lanjut dengan ringkasan.`,
        );
      }

      const title = `Cabang: ${source.title || 'percakapan tanpa judul'}`.slice(0, 120);
      const created = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(conversations)
          .values({
            title,
            surface: source.surface,
            projectId: source.projectId,
            spaceId: source.spaceId,
          })
          .returning();
        // ID baru berurutan (UUIDv7 monoton) sehingga urutan pesan salinan sama dengan aslinya.
        await tx.insert(messages).values(
          rows.map((m) => ({
            id: uuidv7(),
            conversationId: row!.id,
            author: m.author,
            parts: m.parts,
            agentRole: m.agentRole,
            model: m.model,
            createdAt: m.createdAt,
          })),
        );
        return row!;
      });
      return toConversationDto(created);
    },
  };
}
