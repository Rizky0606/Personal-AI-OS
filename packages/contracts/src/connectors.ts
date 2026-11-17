import { z } from 'zod';

/*
 * Konektor MCP pihak ketiga (docs/DESIGN_MCP_KONEKTOR.md). Pemilik mendaftarkan server MCP jarak jauh
 * (https + token statis); gateway yang menjadi klien MCP-nya, dan omp memanggilnya lewat relay loopback
 * worker. Berkas ini hanya memuat nama dan batas yang dipakai bersama gateway, worker, adapter, dan klien.
 */

/**
 * Awalan nama server MCP per konektor. omp menamai toolnya `mcp__konektor_<slug>_<tool>`, jadi awalan ini
 * yang membedakan konektor pemilik dari server MCP lain (`aios_tools`, `aios_browser`, atau konfigurasi luar).
 */
export const MCP_CONNECTOR_SERVER_PREFIX = 'konektor_';

/**
 * Slug konektor: huruf kecil dan angka saja, tanpa garis bawah dan tanda hubung. Batasan itu disengaja supaya
 * `mcp__konektor_<slug>_<tool>` bisa dipecah kembali secara pasti pada garis bawah pertama setelah awalan.
 */
export const CONNECTOR_NAME_PATTERN = /^[a-z][a-z0-9]{1,23}$/;

export const ConnectorNameSchema = z
  .string()
  .trim()
  .regex(CONNECTOR_NAME_PATTERN, 'huruf kecil dan angka, 2-24 karakter, diawali huruf');

/** Nama server MCP yang dilihat omp untuk konektor ini. */
export const connectorServerName = (name: string): string =>
  `${MCP_CONNECTOR_SERVER_PREFIX}${name}`;

export interface ConnectorToolRef {
  /** Slug konektor. */
  connector: string;
  /** Nama tool di server pihak ketiga. */
  tool: string;
}

const OMP_PREFIX = `mcp__${MCP_CONNECTOR_SERVER_PREFIX}`;

/**
 * Memecah nama tool mesin (`mcp__konektor_github_create_issue`) menjadi slug konektor dan nama tool.
 * Null untuk nama lain, termasuk server MCP pihak ketiga yang tidak kita daftarkan.
 */
export function connectorToolOf(name: string): ConnectorToolRef | null {
  const key = name.trim().toLowerCase();
  if (!key.startsWith(OMP_PREFIX)) return null;
  const rest = key.slice(OMP_PREFIX.length);
  const cut = rest.indexOf('_');
  if (cut <= 0) return null;
  const connector = rest.slice(0, cut);
  const tool = rest.slice(cut + 1);
  if (tool === '' || !CONNECTOR_NAME_PATTERN.test(connector)) return null;
  return { connector, tool };
}

/** Panjang maksimum URL konektor (sama dengan sumber pemasangan skill). */
export const CONNECTOR_URL_MAX = 500;
/** Panjang maksimum token statis konektor. */
export const CONNECTOR_TOKEN_MAX = 4096;
/** Nama tool pihak ketiga yang masih masuk akal untuk nama gabungan di mesin agent. */
export const CONNECTOR_TOOL_NAME_MAX = 64;
/** Jumlah tool yang boleh diizinkan per konektor. */
export const CONNECTOR_TOOLS_MAX = 40;
/** Konektor aktif yang ikut ke satu run (batas waktu start omp menunggu semua server MCP terhubung). */
export const CONNECTORS_PER_RUN_MAX = 8;
/** Panggilan tool per konektor per run. */
export const CONNECTOR_CALLS_PER_RUN = 20;
/** Panggilan tool per konektor per 24 jam bergulir (dihitung dari audit, tahan restart gateway). */
export const CONNECTOR_CALLS_PER_DAY = 200;
/** Potongan teks hasil tool pihak ketiga yang diteruskan ke model. */
export const CONNECTOR_RESULT_CHARS = 8000;
