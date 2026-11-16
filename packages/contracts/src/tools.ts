import { z } from 'zod';

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

export const AIOS_TOOL_NAMES = ['web_search', 'web_read'] as const;
export type AiosToolName = (typeof AIOS_TOOL_NAMES)[number];

/** Tool yang mengakses jaringan luar: izinnya berjenis `network`. */
export const AIOS_NETWORK_TOOLS: readonly AiosToolName[] = ['web_search', 'web_read'];

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
