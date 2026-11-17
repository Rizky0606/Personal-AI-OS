import {
  CONNECTOR_CALLS_PER_DAY,
  type McpConnector,
  type McpConnectorProbe,
  type McpConnectorTool,
} from '@aios/contracts';
import { and, asc, eq, gte, like, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { auditLog, mcpConnectors } from '../../db/schema/index.js';
import { AppError } from '../../errors.js';
import { writeAudit } from '../audit/repo.js';
import { decryptSecret, encryptSecret } from '../auth/secrets.js';
import { cleanMessage, ConnectorError, type McpConnectorClient } from './client.js';
import { parseConnectorUrl } from './url.js';

/**
 * Pendaftaran konektor MCP pihak ketiga (docs/DESIGN_MCP_KONEKTOR.md bagian 4-5). Tokennya hanya bisa ditulis:
 * disimpan terenkripsi AES-256-GCM dengan kunci HKDF dari `AUTH_SECRET` dan tidak pernah dikembalikan lewat API,
 * log, audit, atau `lastError`.
 */

/** Aksi audit yang ditulis modul ini; `target` selalu hanya id konektor. */
export const CONNECTOR_CALL_ACTION = 'mcp.connector_called';

export interface NewConnector {
  name: string;
  displayName: string;
  url: string;
  token?: string | undefined;
  tools: McpConnectorTool[];
}

export interface ConnectorEdits {
  displayName?: string | undefined;
  url?: string | undefined;
  /** Tidak dikirim = token tidak berubah; `null` = token dihapus. */
  token?: string | null | undefined;
  tools?: McpConnectorTool[] | undefined;
}

/** Konektor beserta tokennya yang sudah didekripsi; hanya dipakai di dalam gateway. */
export interface ConnectorWithToken extends McpConnector {
  token: string | null;
}

export interface McpConnectorService {
  list(): Promise<McpConnector[]>;
  /** Konektor yang menyala, untuk disusun ke `run.start`. */
  listEnabled(): Promise<McpConnector[]>;
  get(id: string): Promise<McpConnector>;
  /** Konektor menyala beserta token; `null` bila tidak ada atau sedang mati. */
  resolveEnabled(id: string): Promise<ConnectorWithToken | null>;
  create(input: NewConnector, actorDeviceId: string | null): Promise<McpConnector>;
  update(id: string, edits: ConnectorEdits, actorDeviceId: string | null): Promise<McpConnector>;
  remove(id: string, actorDeviceId: string | null): Promise<void>;
  setEnabled(id: string, enabled: boolean, actorDeviceId: string | null): Promise<McpConnector>;
  /** Pratinjau URL yang diketik pemilik; tidak menyimpan apa pun. */
  probe(url: string, token: string | undefined, signal?: AbortSignal): Promise<McpConnectorProbe>;
  /** Pratinjau ulang konektor tersimpan dengan tokennya sendiri; memperbarui `lastProbeAt`/`lastError`. */
  reprobe(
    id: string,
    actorDeviceId: string | null,
    signal?: AbortSignal,
  ): Promise<McpConnectorProbe>;
  /** Jumlah panggilan tool konektor ini dalam 24 jam terakhir (dibaca dari audit). */
  callsToday(id: string): Promise<number>;
  /** Mencatat satu panggilan tool tanpa argumen dan tanpa isi. */
  recordCall(
    id: string,
    runId: string,
    tool: string,
    ok: boolean,
    actorDeviceId: string | null,
  ): Promise<void>;
}

type Row = typeof mcpConnectors.$inferSelect;

const notFound = () =>
  new AppError(404, 'connector_not_found', 'Konektor itu tidak ada atau sudah dihapus.');

export interface McpConnectorServiceDeps {
  db: Database;
  client: McpConnectorClient;
  /** Kunci AES-256-GCM dari `deriveAuthKeys(AUTH_SECRET).connector`. */
  tokenKey: Buffer;
  allowPrivateHosts?: boolean | undefined;
  now?: () => Date;
}

export function createMcpConnectorService(deps: McpConnectorServiceDeps): McpConnectorService {
  const { db, client, tokenKey } = deps;
  const now = deps.now ?? (() => new Date());
  const urlPolicy = { allowPrivateHosts: deps.allowPrivateHosts ?? false };

  const toConnector = (row: Row): McpConnector => ({
    id: row.id,
    name: row.name,
    displayName: row.displayName,
    url: row.url,
    hasToken: row.tokenEnc !== null,
    enabled: row.enabled,
    tools: row.tools,
    lastProbeAt: row.lastProbeAt?.toISOString() ?? null,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });

  /**
   * Token tersimpan yang tidak bisa didekripsi berarti `AUTH_SECRET` berganti. Konektor tetap terbaca (supaya
   * pemilik bisa memperbaikinya), tetapi tokennya dianggap tidak ada dan panggilan akan gagal dengan jelas.
   */
  function tokenOf(row: Row): string | null {
    if (row.tokenEnc === null) return null;
    try {
      return decryptSecret(tokenKey, row.tokenEnc);
    } catch {
      return null;
    }
  }

  async function row(id: string): Promise<Row> {
    const [found] = await db.select().from(mcpConnectors).where(eq(mcpConnectors.id, id)).limit(1);
    if (!found) throw notFound();
    return found;
  }

  async function probeWith(
    url: string,
    token: string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<McpConnectorProbe> {
    const parsed = parseConnectorUrl(url, urlPolicy);
    try {
      const { session, tools, truncated } = await client.probe(
        { url: parsed.toString(), ...(token ? { token } : {}) },
        signal,
      );
      return {
        url: parsed.toString(),
        serverName: session.serverName,
        serverVersion: session.serverVersion,
        protocolVersion: session.protocolVersion,
        tools,
        truncated,
      };
    } catch (error) {
      if (error instanceof ConnectorError)
        throw new AppError(502, 'connector_unreachable', cleanMessage(error.message, token));
      throw error;
    }
  }

  return {
    async list() {
      const rows = await db.select().from(mcpConnectors).orderBy(asc(mcpConnectors.name));
      return rows.map(toConnector);
    },

    async listEnabled() {
      const rows = await db
        .select()
        .from(mcpConnectors)
        .where(eq(mcpConnectors.enabled, true))
        .orderBy(asc(mcpConnectors.name));
      // Konektor tanpa satu pun tool yang diizinkan tidak berguna untuk run: jangan dibawa ke worker.
      return rows.filter((r) => r.tools.length > 0).map(toConnector);
    },

    async get(id) {
      return toConnector(await row(id));
    },

    async resolveEnabled(id) {
      const [found] = await db
        .select()
        .from(mcpConnectors)
        .where(and(eq(mcpConnectors.id, id), eq(mcpConnectors.enabled, true)))
        .limit(1);
      if (!found || found.tools.length === 0) return null;
      return { ...toConnector(found), token: tokenOf(found) };
    },

    async create(input, actorDeviceId) {
      const url = parseConnectorUrl(input.url, urlPolicy);
      const [existing] = await db
        .select({ id: mcpConnectors.id })
        .from(mcpConnectors)
        .where(eq(mcpConnectors.name, input.name))
        .limit(1);
      if (existing)
        throw new AppError(
          409,
          'connector_name_taken',
          `Nama "${input.name}" sudah dipakai konektor lain. Pilih nama lain.`,
        );
      const [saved] = await db
        .insert(mcpConnectors)
        .values({
          name: input.name,
          displayName: input.displayName,
          url: url.toString(),
          tokenEnc: input.token ? encryptSecret(tokenKey, input.token) : null,
          tools: input.tools,
          enabled: false,
        })
        .returning();
      if (!saved) throw new AppError(500, 'internal_error', 'Konektor gagal disimpan.');
      await writeAudit(db, {
        actorDeviceId,
        action: 'mcp_connector.created',
        target: `connector:${saved.id}`,
      });
      return toConnector(saved);
    },

    async update(id, edits, actorDeviceId) {
      const current = await row(id);
      const url = edits.url === undefined ? undefined : parseConnectorUrl(edits.url, urlPolicy);
      const [saved] = await db
        .update(mcpConnectors)
        .set({
          ...(edits.displayName === undefined ? {} : { displayName: edits.displayName }),
          ...(url === undefined ? {} : { url: url.toString() }),
          ...(edits.token === undefined
            ? {}
            : { tokenEnc: edits.token === null ? null : encryptSecret(tokenKey, edits.token) }),
          ...(edits.tools === undefined ? {} : { tools: edits.tools }),
          // URL atau token berubah: sesi lama tidak berlaku lagi.
          ...(url === undefined && edits.token === undefined ? {} : { lastError: null }),
        })
        .where(eq(mcpConnectors.id, current.id))
        .returning();
      if (!saved) throw notFound();
      if (url !== undefined || edits.token !== undefined) client.forget(id);
      await writeAudit(db, {
        actorDeviceId,
        action: 'mcp_connector.updated',
        target: `connector:${id}`,
      });
      return toConnector(saved);
    },

    async remove(id, actorDeviceId) {
      const deleted = await db
        .delete(mcpConnectors)
        .where(eq(mcpConnectors.id, id))
        .returning({ id: mcpConnectors.id });
      if (deleted.length === 0) throw notFound();
      client.forget(id);
      await writeAudit(db, {
        actorDeviceId,
        action: 'mcp_connector.deleted',
        target: `connector:${id}`,
      });
    },

    async setEnabled(id, enabled, actorDeviceId) {
      const current = await row(id);
      if (enabled && current.tools.length === 0)
        throw new AppError(
          422,
          'connector_no_tools',
          'Pilih dulu tool yang boleh dipakai sebelum menyalakan konektor ini.',
        );
      const [saved] = await db
        .update(mcpConnectors)
        .set({ enabled })
        .where(eq(mcpConnectors.id, id))
        .returning();
      if (!saved) throw notFound();
      client.forget(id);
      await writeAudit(db, {
        actorDeviceId,
        action: enabled ? 'mcp_connector.enabled' : 'mcp_connector.disabled',
        target: `connector:${id}`,
      });
      return toConnector(saved);
    },

    async probe(url, token, signal) {
      return probeWith(url, token, signal);
    },

    async reprobe(id, actorDeviceId, signal) {
      const current = await row(id);
      const token = tokenOf(current) ?? undefined;
      try {
        const result = await probeWith(current.url, token, signal);
        await db
          .update(mcpConnectors)
          .set({ lastProbeAt: now(), lastError: null })
          .where(eq(mcpConnectors.id, id));
        await writeAudit(db, {
          actorDeviceId,
          action: 'mcp_connector.probed',
          target: `connector:${id}`,
        });
        return result;
      } catch (error) {
        const detail = error instanceof AppError ? error.message : 'Konektor tidak bisa dihubungi.';
        await db
          .update(mcpConnectors)
          .set({ lastProbeAt: now(), lastError: cleanMessage(detail, token) })
          .where(eq(mcpConnectors.id, id));
        throw error;
      }
    },

    async callsToday(id) {
      const since = new Date(now().getTime() - 24 * 60 * 60_000);
      const [counted] = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.action, CONNECTOR_CALL_ACTION),
            like(auditLog.target, `connector:${id} %`),
            gte(auditLog.ts, since),
          ),
        );
      return counted?.total ?? 0;
    },

    async recordCall(id, runId, tool, ok, actorDeviceId) {
      await writeAudit(db, {
        actorDeviceId,
        action: CONNECTOR_CALL_ACTION,
        // Tanpa argumen dan tanpa isi hasil (docs/DESIGN_MCP_KONEKTOR.md bagian 5).
        target: `connector:${id} run:${runId} tool:${tool} ${ok ? 'ok' : 'error'}`,
      });
    },
  };
}

export { CONNECTOR_CALLS_PER_DAY };
