import { RoleIdSchema, SurfaceSchema } from '@aios/contracts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { ROLES_PACKAGE_DIR } from '../registry.js';

export const ROUTING_EVAL_FILE = join(ROLES_PACKAGE_DIR, 'evals', 'routing.jsonl');

/** Satu baris `routing.jsonl`. `expect` adalah role yang benar untuk konteks itu. */
export const EvalCaseSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  message: z.string().min(1),
  surface: SurfaceSchema,
  project: z.strictObject({ name: z.string().min(1), stack: z.string().optional() }).optional(),
  previousRole: RoleIdSchema.optional(),
  history: z
    .array(z.strictObject({ author: z.enum(['user', 'assistant']), text: z.string() }))
    .optional(),
  expect: RoleIdSchema,
  /** `lanjutan`, `ambigu`, `android-tanpa-project`, dan sejenisnya. */
  tags: z.array(z.string()).optional(),
});
export type EvalCase = z.infer<typeof EvalCaseSchema>;

/** Membaca dan memvalidasi dataset; melempar dengan nomor baris bila ada yang salah. */
export function parseEvalCases(text: string): EvalCase[] {
  const cases: EvalCase[] = [];
  const seen = new Set<string>();
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      throw new Error(`routing.jsonl baris ${index + 1}: bukan JSON`);
    }
    const parsed = EvalCaseSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new Error(
        `routing.jsonl baris ${index + 1}: ${issue?.path.join('.') ?? ''} ${issue?.message ?? 'tidak valid'}`,
      );
    }
    if (seen.has(parsed.data.id)) {
      throw new Error(`routing.jsonl baris ${index + 1}: id "${parsed.data.id}" dobel`);
    }
    seen.add(parsed.data.id);
    cases.push(parsed.data);
  });
  return cases;
}

export function loadEvalCases(file: string = ROUTING_EVAL_FILE): EvalCase[] {
  return parseEvalCases(readFileSync(file, 'utf8'));
}
