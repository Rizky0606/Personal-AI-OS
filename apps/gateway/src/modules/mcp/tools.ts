import type { AiosToolName } from '@aios/contracts';
import { z } from 'zod';

/** Keadaan run yang tidak disentuh selama ini dibuang (run terlama 2 jam, RunStartCommand.timeoutMs). */
export const STATE_TTL_MS = 3 * 60 * 60_000;

export interface ToolDef {
  name: AiosToolName;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; openWorldHint: boolean };
}

export interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

/** Hasil satu panggilan tool beserta ringkasan tanpa isi (untuk log dan audit). */
export interface ToolOutcome {
  result: ToolResult;
  ok: boolean;
  /** Jumlah butir yang dikembalikan (hasil, kartu, potongan) atau 1 (halaman terbaca); 0 bila gagal. */
  items: number;
}

/** Pemanggil `/v1/mcp`: worker (omp, terikat run) atau Hermes (token layanan dari loopback, tanpa run). */
export type McpPrincipal = 'worker' | 'hermes';

export interface ToolContext {
  principal: McpPrincipal;
  /** Run yang memanggil (principal worker); null untuk Hermes. */
  runId: string | null;
  /** Kunci anggaran dan allowlist `web_read`: per run (worker) atau per jam (Hermes). */
  budgetKey: string;
  /** Pengali anggaran per kunci: 1 per run, `HERMES_BUDGET_SCALE` per jam untuk Hermes. */
  budgetScale: number;
  /** Project run itu (principal worker); tool kanban hanya membaca project ini. */
  projectId?: string | undefined;
  /** Percakapan run itu; usulan menautkannya. */
  conversationId?: string | null | undefined;
  /** Run mode rencana: tool usulan ditolak (docs/DESIGN_MCP_TOOLS.md keputusan #5). */
  planOnly?: boolean | undefined;
  /** Model run (atau nama mesin), dicatat di usulan memori. */
  model?: string | undefined;
  /** Perangkat worker yang memanggil (audit usulan); null/absen untuk Hermes. */
  deviceId?: string | null | undefined;
  signal?: AbortSignal;
}

/** Hermes tidak terikat run: anggaran per jam sebesar anggaran satu run dikali ini (docs/DESIGN_MCP_TOOLS.md bagian 7). */
export const HERMES_BUDGET_SCALE = 4;
const HOUR_MS = 60 * 60_000;

/** Identitas dan anggaran principal worker untuk satu run. */
export function workerContext(
  runId: string,
): Pick<ToolContext, 'principal' | 'runId' | 'budgetKey' | 'budgetScale'> {
  return { principal: 'worker', runId, budgetKey: `run:${runId}`, budgetScale: 1 };
}

/** Identitas dan anggaran Hermes: jendela per jam (jam UTC berjalan), tanpa run. */
export function hermesContext(
  now: number,
): Pick<ToolContext, 'principal' | 'runId' | 'budgetKey' | 'budgetScale'> {
  return {
    principal: 'hermes',
    runId: null,
    budgetKey: `hermes:${Math.floor(now / HOUR_MS)}`,
    budgetScale: HERMES_BUDGET_SCALE,
  };
}

/** Sekumpulan tool `aios_tools`; beberapa kumpulan digabung dengan [combineTools]. */
export interface ToolSet {
  list(): ToolDef[];
  /** Null bila nama tool tidak dikenal (galat protokol, bukan galat tool). */
  call(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome | null>;
}

/** Satu server, beberapa kumpulan tool: daftar digabung berurutan, panggilan ke kumpulan pertama yang mengenalinya. */
export function combineTools(...sets: ToolSet[]): ToolSet {
  return {
    list: () => sets.flatMap((set) => set.list()),
    async call(name, args, ctx) {
      for (const set of sets) {
        const outcome = await set.call(name, args, ctx);
        if (outcome) return outcome;
      }
      return null;
    },
  };
}

/** JSON Schema masukan untuk `tools/list`, tanpa `$schema` (MCP hanya butuh skema objeknya). */
export const jsonSchema = (schema: z.ZodType): Record<string, unknown> => {
  const out: Record<string, unknown> = z.toJSONSchema(schema, { io: 'input' });
  delete out.$schema;
  return out;
};

export const oneLine = (text: string, max: number) =>
  text.replace(/\s+/g, ' ').trim().slice(0, max);

/** Konten tidak tepercaya dipagari `<<< >>>`; pagar di dalam konten dinetralkan supaya tidak bisa ditutup dari dalam. */
export const fenced = (lines: string[]) =>
  ['<<<', lines.join('\n').replaceAll('<<<', '‹‹‹').replaceAll('>>>', '›››'), '>>>'].join('\n');

export const textResult = (text: string, isError = false): ToolResult => ({
  content: [{ type: 'text', text }],
  ...(isError ? { isError: true } : {}),
});

export const failure = (text: string): ToolOutcome => ({
  result: textResult(text, true),
  ok: false,
  items: 0,
});

export const reasonOf = (error: unknown) =>
  error instanceof Error && error.message ? oneLine(error.message, 200) : 'tidak diketahui';

export const issuesOf = (error: z.ZodError) =>
  error.issues.map((i) => `${i.path.join('.') || 'argumen'}: ${i.message}`).join('; ');
