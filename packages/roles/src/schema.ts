import { RoleIdSchema } from '@aios/contracts';
import { z } from 'zod';

/**
 * Skill inti: dimuat untuk semua role (ROLES_AND_SKILLS.md). Lima pertama anti-melenceng; `rich-answers` mengatur
 * kapan jawaban memakai komponen aios-ui, berlaku di semua mesin yang jawabannya dirender klien.
 */
export const CORE_SKILLS = [
  'scope-guard',
  'read-context-first',
  'plan-before-edit',
  'verify-before-done',
  'minimal-diff',
  'rich-answers',
] as const;

export const SkillIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/, 'id skill: huruf kecil, angka, tanda hubung');

const nonEmpty = z.string().trim().min(1);

/** Frontmatter `packages/roles/roles/<id>.md`. Nama field mengikuti format di dokumen (snake_case). */
export const RoleFrontmatterSchema = z
  .strictObject({
    id: RoleIdSchema,
    name: nonEmpty,
    group: z.enum(['coding', 'umum']),
    engine: z.enum(['omp', 'hermes', 'research']),
    /** Nama combo di 9Router. */
    model: nonEmpty,
    fallback_model: nonEmpty.optional(),
    approval: z.enum(['ask', 'auto-safe']),
    skills: z.array(SkillIdSchema).min(1),
  })
  .refine((r) => new Set(r.skills).size === r.skills.length, {
    path: ['skills'],
    message: 'skill tidak boleh dobel',
  });
export type RoleFrontmatter = z.infer<typeof RoleFrontmatterSchema>;

/** Frontmatter `packages/roles/skills/<id>/SKILL.md`. */
export const SkillFrontmatterSchema = z.strictObject({
  name: SkillIdSchema,
  description: nonEmpty,
});
export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;
