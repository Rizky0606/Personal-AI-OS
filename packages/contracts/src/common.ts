import { z } from 'zod';

/** UUIDv7 (API_CONTRACT.md, Konvensi). */
export const IdSchema = z.uuidv7();
export type Id = z.infer<typeof IdSchema>;

/** Waktu UTC, ISO 8601 dengan akhiran Z. */
export const TimestampSchema = z.iso.datetime();
export type Timestamp = z.infer<typeof TimestampSchema>;

/** ID role. Role ditambah lewat file di packages/roles, jadi bukan enum tertutup. */
export const RoleIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/, 'role id: huruf kecil, angka, tanda hubung');
export type RoleId = z.infer<typeof RoleIdSchema>;

export const INITIAL_ROLE_IDS = [
  'general',
  'researcher',
  'writer',
  'frontend',
  'backend',
  'debugger',
  'reviewer',
] as const;

export const SurfaceSchema = z.enum(['android', 'windows']);
export type Surface = z.infer<typeof SurfaceSchema>;

export const DeviceKindSchema = z.enum(['android', 'desktop', 'worker']);
export type DeviceKind = z.infer<typeof DeviceKindSchema>;

export const ScopeSchema = z.enum(['app', 'worker', 'llm']);
export type Scope = z.infer<typeof ScopeSchema>;

export const EngineSchema = z.enum(['hermes', 'omp', 'pi', 'research']);
export type Engine = z.infer<typeof EngineSchema>;

export const UsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    reasoningTokens: z.number().int().nonnegative().optional(),
    cachedTokens: z.number().int().nonnegative().optional(),
  })
  .meta({ id: 'Usage' });
export type Usage = z.infer<typeof UsageSchema>;

export const RunErrorSchema = z
  .object({
    code: z.string().min(1),
    message: z.string(),
    retryable: z.boolean(),
  })
  .meta({ id: 'RunError' });
export type RunError = z.infer<typeof RunErrorSchema>;

/** Error RFC 9457 (application/problem+json). `code` adalah kode domain yang stabil. */
export const ProblemSchema = z
  .object({
    type: z.string().min(1),
    title: z.string(),
    status: z.number().int().min(400).max(599),
    detail: z.string(),
    code: z.string().min(1),
    instance: z.string().optional(),
    errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  })
  .meta({ id: 'Problem' });
export type Problem = z.infer<typeof ProblemSchema>;

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/** Pagination berbasis kursor: ?before=<id>&limit=50 (default 50, maks 100). */
export const PageQuerySchema = z.object({
  before: IdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type PageQuery = z.infer<typeof PageQuerySchema>;

export function pageOf<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    nextBefore: IdSchema.nullable(),
  });
}
