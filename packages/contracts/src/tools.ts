import { z } from 'zod';
import {
  MEMORY_PROPOSAL_LIMITS,
  PROPOSAL_REASON_MAX,
  ProposedScheduleTargetSchema,
  SCHEDULE_PROPOSAL_NAME_MAX,
  SCHEDULE_PROPOSAL_PROMPT_MAX,
  TASK_PROPOSAL_BODY_MAX,
  TASK_PROPOSAL_TITLE_MAX,
} from './api-schemas.js';
import { IdSchema } from './common.js';
import { CronSchema, DEFAULT_TIMEZONE, TaskStatusSchema } from './entities.js';

/*
 * Tool gateway lewat MCP (docs/DESIGN_MCP_TOOLS.md). Gateway menyajikan server MCP `aios_tools` di
 * `POST /v1/mcp`; omp memanggilnya lewat relay loopback di worker yang menyisipkan token perangkat dan
 * `X-Aios-Run-Id`.
 */

/** Nama server MCP; omp menamai tool-nya `mcp__aios_tools_<tool>`, Hermes `mcp__aios_tools__<tool>`. */
export const AIOS_TOOLS_SERVER = 'aios_tools';

/** Awalan nama tool server ini di omp (dipakai mengenali permintaan izin dan langkah tool). */
export const AIOS_TOOLS_OMP_PREFIX = `mcp__${AIOS_TOOLS_SERVER}_`;

/** Header run yang disisipkan relay worker (bukan omp); sama dengan header proxy LLM. */
export const RUN_ID_HEADER = 'x-aios-run-id';

export const AIOS_TOOL_NAMES = [
  'web_search',
  'web_read',
  'memory_list',
  'space_search',
  'task_list',
  'schedule_list',
  'memory_propose',
  'task_propose',
  'schedule_propose',
] as const;
export type AiosToolName = (typeof AIOS_TOOL_NAMES)[number];

/** Tool yang mengakses jaringan luar: izinnya berjenis `network`. */
export const AIOS_NETWORK_TOOLS: readonly AiosToolName[] = ['web_search', 'web_read'];

/**
 * Tool yang hanya membaca data sistem sendiri (memori, ruang, kanban, jadwal): tidak ada yang keluar dari sistem,
 * jadi worker mengizinkannya tanpa bertanya, termasuk di mode rencana (docs/DESIGN_MCP_TOOLS.md bagian 7).
 */
export const AIOS_DATA_TOOLS: readonly AiosToolName[] = [
  'memory_list',
  'space_search',
  'task_list',
  'schedule_list',
];

/**
 * Tool tulis yang hanya membuat usulan; tidak ada yang berubah sebelum pemilik menyetujui. Worker mengizinkannya
 * tanpa bertanya, kecuali di mode rencana (ditolak). docs/DESIGN_MCP_TOOLS.md bagian 17.
 */
export const AIOS_PROPOSE_TOOLS: readonly AiosToolName[] = [
  'memory_propose',
  'task_propose',
  'schedule_propose',
];

export const WEB_SEARCH_QUERY_MAX = 200;
export const WEB_SEARCH_LIMIT_MAX = 8;

export const WebSearchInputSchema = z
  .object({
    query: z
      .string()
      .trim()
      .min(1)
      .max(WEB_SEARCH_QUERY_MAX)
      .describe('Kueri pencarian, maksimal 200 karakter'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(WEB_SEARCH_LIMIT_MAX)
      .optional()
      .describe('Jumlah hasil (1-8, bawaan 5)'),
  })
  .strict();

export const WebReadInputSchema = z
  .object({
    url: z
      .string()
      .trim()
      .min(1)
      .max(2000)
      .describe('URL dari hasil web_search run ini atau dari pesan pemilik'),
  })
  .strict();

/** Kueri tool data (cocok kata, bukan dikirim ke luar). */
export const DATA_QUERY_MAX = 200;

export const MemoryListInputSchema = z
  .object({
    query: z
      .string()
      .trim()
      .max(DATA_QUERY_MAX)
      .optional()
      .describe('Kata kunci untuk mendahulukan memori yang cocok (opsional)'),
  })
  .strict();

export const SpaceSearchInputSchema = z
  .object({
    query: z
      .string()
      .trim()
      .min(1)
      .max(DATA_QUERY_MAX)
      .describe('Kata kunci pencarian di dokumen ruang pengetahuan, maksimal 200 karakter'),
    spaceId: IdSchema.optional().describe('Batasi ke satu ruang (opsional; bawaan semua ruang)'),
  })
  .strict();

export const TaskListInputSchema = z
  .object({
    projectId: IdSchema.optional().describe(
      'Project kanban (opsional; hanya project run ini yang boleh dibaca)',
    ),
    status: TaskStatusSchema.optional().describe('Saring menurut kolom (opsional)'),
  })
  .strict();

export const ScheduleListInputSchema = z.object({}).strict();

export const MemoryProposeInputSchema = z
  .object({
    text: z
      .string()
      .trim()
      .min(1)
      .max(MEMORY_PROPOSAL_LIMITS.textMax)
      .describe('Satu kalimat pernyataan tentang pemilik, mis. "Pemilik tinggal di Bandung."'),
    evidence: z
      .string()
      .trim()
      .min(1)
      .max(MEMORY_PROPOSAL_LIMITS.evidenceMax)
      .describe('Kutipan PERSIS dari pesan pemilik yang menjadi dasar fakta ini'),
  })
  .strict();

export const TaskProposeInputSchema = z
  .object({
    title: z.string().trim().min(1).max(TASK_PROPOSAL_TITLE_MAX).describe('Judul kartu'),
    body: z
      .string()
      .trim()
      .max(TASK_PROPOSAL_BODY_MAX)
      .optional()
      .describe('Isi kartu: apa yang perlu dikerjakan (opsional)'),
    reason: z
      .string()
      .trim()
      .min(1)
      .max(PROPOSAL_REASON_MAX)
      .describe('Mengapa kartu ini diusulkan, untuk pemilik'),
    projectId: IdSchema.optional().describe(
      'Project kanban (opsional; hanya project run ini yang boleh)',
    ),
  })
  .strict();

export const ScheduleProposeInputSchema = z
  .object({
    name: z.string().trim().min(1).max(SCHEDULE_PROPOSAL_NAME_MAX).describe('Nama jadwal'),
    cron: CronSchema.describe('Cron 5 field: menit jam tanggal bulan hari-minggu'),
    timezone: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .optional()
      .describe(`Zona waktu IANA (bawaan ${DEFAULT_TIMEZONE})`),
    prompt: z
      .string()
      .trim()
      .min(1)
      .max(SCHEDULE_PROPOSAL_PROMPT_MAX)
      .describe('Perintah yang dijalankan tiap jadwal tiba'),
    target: ProposedScheduleTargetSchema.describe(
      'chat (jawaban agent) atau research (laporan riset)',
    ),
    reason: z
      .string()
      .trim()
      .min(1)
      .max(PROPOSAL_REASON_MAX)
      .describe('Mengapa jadwal ini diusulkan, untuk pemilik'),
  })
  .strict();

/** Pesan JSON-RPC 2.0 (atau batch) untuk `POST /mcp`; isinya divalidasi server MCP, bukan skema ini. */
export const McpMessageSchema = z
  .union([z.record(z.string(), z.unknown()), z.array(z.record(z.string(), z.unknown()))])
  .meta({ id: 'McpMessage' });

const AIOS_TOOLS_HERMES_PREFIX = `mcp__${AIOS_TOOLS_SERVER}__`;

/**
 * Nama tool `aios_tools` dari nama tool mesin: `mcp__aios_tools_web_search` (omp) atau
 * `mcp__aios_tools__web_search` (Hermes). Null untuk nama lain atau tool yang tidak dikenal.
 */
export function aiosToolOf(name: string): AiosToolName | null {
  const key = name.trim().toLowerCase();
  const rest = key.startsWith(AIOS_TOOLS_HERMES_PREFIX)
    ? key.slice(AIOS_TOOLS_HERMES_PREFIX.length)
    : key.startsWith(AIOS_TOOLS_OMP_PREFIX)
      ? key.slice(AIOS_TOOLS_OMP_PREFIX.length)
      : null;
  return rest !== null && (AIOS_TOOL_NAMES as readonly string[]).includes(rest)
    ? (rest as AiosToolName)
    : null;
}
