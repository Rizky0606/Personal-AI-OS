import type {
  CreatePromptTemplateRequestSchema,
  PromptTemplate,
  UpdatePromptTemplateRequestSchema,
} from '@aios/contracts';
import { asc, count, eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { Database } from '../../db/client.js';
import { promptTemplates } from '../../db/schema/index.js';
import { AppError } from '../../errors.js';

/** Batas jumlah templat supaya daftar di composer tetap bisa dipindai. */
export const MAX_PROMPT_TEMPLATES = 100;

export interface TemplateService {
  list(): Promise<PromptTemplate[]>;
  create(input: z.infer<typeof CreatePromptTemplateRequestSchema>): Promise<PromptTemplate>;
  update(
    id: string,
    patch: z.infer<typeof UpdatePromptTemplateRequestSchema>,
  ): Promise<PromptTemplate>;
  remove(id: string): Promise<void>;
}

type Row = typeof promptTemplates.$inferSelect;

const toDto = (row: Row): PromptTemplate => ({
  id: row.id,
  name: row.name,
  body: row.body,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const notFound = () => new AppError(404, 'template_not_found', 'Templat tidak ditemukan.');
const duplicate = (name: string) =>
  new AppError(409, 'template_name_taken', `Sudah ada templat bernama /${name}.`);

/** Kode galat unik Postgres (nama templat kembar). */
const isUniqueViolation = (error: unknown): boolean =>
  (error as { code?: string; cause?: { code?: string } })?.code === '23505' ||
  (error as { cause?: { code?: string } })?.cause?.code === '23505';

export function createTemplateService(deps: { db: Database }): TemplateService {
  const { db } = deps;

  return {
    async list() {
      const rows = await db.select().from(promptTemplates).orderBy(asc(promptTemplates.name));
      return rows.map(toDto);
    },

    async create({ name, body }) {
      const [total] = await db.select({ n: count() }).from(promptTemplates);
      if ((total?.n ?? 0) >= MAX_PROMPT_TEMPLATES) {
        throw new AppError(
          409,
          'template_limit',
          `Templat sudah ${MAX_PROMPT_TEMPLATES}. Hapus yang tidak dipakai sebelum menambah yang baru.`,
        );
      }
      try {
        const [row] = await db.insert(promptTemplates).values({ name, body }).returning();
        return toDto(row!);
      } catch (error) {
        if (isUniqueViolation(error)) throw duplicate(name);
        throw error;
      }
    },

    async update(id, patch) {
      try {
        const [row] = await db
          .update(promptTemplates)
          .set({
            ...(patch.name !== undefined ? { name: patch.name } : {}),
            ...(patch.body !== undefined ? { body: patch.body } : {}),
          })
          .where(eq(promptTemplates.id, id))
          .returning();
        if (!row) throw notFound();
        return toDto(row);
      } catch (error) {
        if (isUniqueViolation(error)) throw duplicate(patch.name ?? '');
        throw error;
      }
    },

    async remove(id) {
      const deleted = await db
        .delete(promptTemplates)
        .where(eq(promptTemplates.id, id))
        .returning({ id: promptTemplates.id });
      if (!deleted.length) throw notFound();
    },
  };
}
