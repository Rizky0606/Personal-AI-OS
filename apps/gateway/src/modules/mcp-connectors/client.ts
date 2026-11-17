import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { CONNECTOR_TOOL_NAME_MAX, CONNECTOR_TOOLS_MAX } from '@aios/contracts';
import type { McpConnectorTool } from '@aios/contracts';
import { guardedLookup } from '../research/ssrf.js';
import {
  assertSameOriginRedirect,
  originOf,
  parseConnectorUrl,
  type ConnectorUrlOptions,
} from './url.js';

/*
 * Klien MCP untuk konektor pihak ketiga (docs/DESIGN_MCP_KONEKTOR.md bagian 9). JSON-RPC 2.0 di atas
 * Streamable HTTP, versi protokol sama dengan server MCP kita sendiri. Ditulis sendiri di atas `node:http(s)`
 * karena hanya di sana `lookup` bisa diganti: tanpa `guardedLookup` tidak ada penjaga SSRF saat koneksi
 * dibuka, dan `fetch` global tidak menerimanya.
 */

/** Sama dengan `MCP_PROTOCOL_VERSION` server kita (`modules/mcp/server.ts`). */
export const CONNECTOR_PROTOCOL_VERSION = '2025-03-26';

const DEFAULTS = {
  timeoutMs: 20_000,
  maxBytes: 1024 * 1024,
  maxRedirects: 3,
};

/** Kegagalan yang bisa ditunjukkan ke pemilik; pesannya tidak pernah memuat token. */
export class ConnectorError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ConnectorError';
  }
}

export interface ConnectorTarget {
  url: string;
  /** Token statis; null/undefined = konektor tanpa autentikasi. */
  token?: string | null | undefined;
}

export interface ConnectorSession {
  protocolVersion: string;
  serverName: string;
  serverVersion: string;
  /** Header `Mcp-Session-Id` bila server memakainya. */
  sessionId: string | undefined;
}

export interface ConnectorToolResult {
  content: unknown[];
  isError: boolean;
}

export interface McpConnectorClientOptions extends ConnectorUrlOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

export interface McpConnectorClient {
  /** `initialize` + `notifications/initialized` + `tools/list` tanpa menyimpan sesi (dipakai pratinjau). */
  probe(
    target: ConnectorTarget,
    signal?: AbortSignal,
  ): Promise<{ session: ConnectorSession; tools: McpConnectorTool[]; truncated: boolean }>;
  /** `tools/call` dengan sesi yang dipakai ulang per konektor. */
  callTool(
    connectorId: string,
    target: ConnectorTarget,
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<ConnectorToolResult>;
  /** Melupakan sesi tersimpan (konektor diubah atau dihapus). */
  forget(connectorId: string): void;
}

interface HttpReply {
  status: number;
  sessionId: string | undefined;
  contentType: string;
  text: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Pesan galat dari luar dipendekkan dan dibersihkan dari token sebelum ditampilkan atau disimpan. Ambang 4
 * karakter sengaja rendah: server pihak ketiga yang memantulkan token di pesan galatnya tidak boleh membuat
 * token itu muncul di `lastError`, di hasil tool, atau di layar pemilik.
 */
export function cleanMessage(message: string, token?: string | null): string {
  let text = message.replace(/\s+/g, ' ').trim().slice(0, 200);
  if (token && token.length >= 4) text = text.split(token).join('***');
  return text;
}

/** Satu pesan JSON-RPC dari jawaban `text/event-stream` (satu atau beberapa bingkai `data:`). */
function parseEventStream(body: string): unknown[] {
  const messages: unknown[] = [];
  for (const frame of body.split(/\r?\n\r?\n/)) {
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (data === '') continue;
    try {
      messages.push(JSON.parse(data));
    } catch {
      // Bingkai yang tidak bisa dibaca diabaikan; pesan yang dicari mungkin ada di bingkai lain.
    }
  }
  return messages;
}

export function createConnectorClient(options: McpConnectorClientOptions = {}): McpConnectorClient {
  const { timeoutMs, maxBytes, maxRedirects } = { ...DEFAULTS, ...options };
  const policy: ConnectorUrlOptions = { allowPrivateHosts: options.allowPrivateHosts ?? false };
  const lookup = guardedLookup(policy);
  const sessions = new Map<string, ConnectorSession>();
  let nextId = 1;

  function once(
    url: URL,
    payload: string,
    headers: Record<string, string>,
    signal: AbortSignal | undefined,
  ): Promise<IncomingMessage> {
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    return new Promise((resolve, reject) => {
      const req = send(
        url,
        {
          method: 'POST',
          lookup,
          timeout: timeoutMs,
          ...(signal ? { signal } : {}),
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            'user-agent': 'PersonalAIOS-Connector/1.0',
            ...headers,
          },
        },
        resolve,
      );
      req.on('timeout', () =>
        req.destroy(
          new ConnectorError('connector_timeout', 'Konektor tidak menjawab tepat waktu.'),
        ),
      );
      req.on('error', (err) => {
        if (err instanceof ConnectorError) return reject(err);
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'EBLOCKED')
          return reject(
            new ConnectorError(
              'connector_url_blocked',
              'Alamat konektor menunjuk ke jaringan privat.',
            ),
          );
        if (signal?.aborted) return reject(err);
        reject(
          new ConnectorError(
            'connector_unreachable',
            `Konektor tidak bisa dihubungi (${code ?? 'error'}).`,
          ),
        );
      });
      req.end(payload);
    });
  }

  /** POST ke konektor dengan redirect yang dicek ulang dan tetap di origin yang sama. */
  async function post(
    first: URL,
    payload: string,
    headers: Record<string, string>,
    signal: AbortSignal | undefined,
  ): Promise<HttpReply> {
    const origin = originOf(first);
    let url = first;
    for (let hop = 0; ; hop++) {
      const res = await once(url, payload, headers, signal);
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (hop >= maxRedirects)
          throw new ConnectorError('connector_unreachable', 'Konektor terlalu banyak mengalihkan.');
        url = new URL(res.headers.location, url);
        assertSameOriginRedirect(url, origin, policy);
        continue;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      await new Promise<void>((resolve, reject) => {
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            res.destroy();
            reject(new ConnectorError('connector_too_large', 'Jawaban konektor terlalu besar.'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', resolve);
        res.on('error', reject);
      });
      const sessionHeader = res.headers['mcp-session-id'];
      return {
        status,
        sessionId: typeof sessionHeader === 'string' ? sessionHeader : undefined,
        contentType: String(res.headers['content-type'] ?? ''),
        text: Buffer.concat(chunks).toString('utf8'),
      };
    }
  }

  function authHeaders(
    target: ConnectorTarget,
    session?: ConnectorSession,
  ): Record<string, string> {
    return {
      ...(target.token ? { authorization: `Bearer ${target.token}` } : {}),
      'mcp-protocol-version': session?.protocolVersion ?? CONNECTOR_PROTOCOL_VERSION,
      ...(session?.sessionId ? { 'mcp-session-id': session.sessionId } : {}),
    };
  }

  /** Satu permintaan JSON-RPC dengan jawaban; melempar `ConnectorError` untuk galat protokol dan transport. */
  async function rpc(
    url: URL,
    target: ConnectorTarget,
    session: ConnectorSession | undefined,
    method: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
  ): Promise<{ result: Record<string, unknown>; sessionId: string | undefined }> {
    const id = nextId++;
    const reply = await post(
      url,
      JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      authHeaders(target, session),
      signal,
    );
    if (reply.status === 401 || reply.status === 403)
      throw new ConnectorError(
        'connector_unauthorized',
        'Konektor menolak token (HTTP ' + reply.status + ').',
      );
    if (reply.status === 404 || reply.status === 400)
      throw new ConnectorError('connector_session_lost', `Konektor menjawab HTTP ${reply.status}.`);
    if (reply.status < 200 || reply.status >= 300)
      throw new ConnectorError('connector_unreachable', `Konektor menjawab HTTP ${reply.status}.`);

    const messages = reply.contentType.includes('text/event-stream')
      ? parseEventStream(reply.text)
      : [parseJsonBody(reply.text)];
    const message = messages.find((m) => isRecord(m) && m.id === id) ?? messages.at(-1);
    if (!isRecord(message))
      throw new ConnectorError('connector_protocol', 'Jawaban konektor bukan pesan JSON-RPC.');
    if (isRecord(message.error)) {
      const detail =
        typeof message.error.message === 'string' ? message.error.message : 'tanpa pesan';
      throw new ConnectorError('connector_rpc_error', cleanMessage(detail, target.token));
    }
    if (!isRecord(message.result))
      throw new ConnectorError('connector_protocol', 'Jawaban konektor tanpa `result`.');
    return { result: message.result, sessionId: reply.sessionId };
  }

  function parseJsonBody(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      throw new ConnectorError('connector_protocol', 'Jawaban konektor bukan JSON.');
    }
  }

  /** Handshake lengkap: `initialize`, lalu notifikasi `initialized` yang kegagalannya tidak fatal. */
  async function initialize(
    url: URL,
    target: ConnectorTarget,
    signal: AbortSignal | undefined,
  ): Promise<ConnectorSession> {
    const { result, sessionId } = await rpc(
      url,
      target,
      undefined,
      'initialize',
      {
        protocolVersion: CONNECTOR_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'personal-ai-os', version: '1' },
      },
      signal,
    );
    const info = isRecord(result.serverInfo) ? result.serverInfo : {};
    const session: ConnectorSession = {
      protocolVersion:
        typeof result.protocolVersion === 'string'
          ? result.protocolVersion
          : CONNECTOR_PROTOCOL_VERSION,
      serverName: typeof info.name === 'string' ? info.name.slice(0, 80) : 'tidak dikenal',
      serverVersion: typeof info.version === 'string' ? info.version.slice(0, 40) : '',
      sessionId,
    };
    await post(
      url,
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      authHeaders(target, session),
      signal,
    ).catch(() => undefined);
    return session;
  }

  /** Daftar tool dari `tools/list`, dipangkas ke batas kontrak. */
  function toolsOf(result: Record<string, unknown>): {
    tools: McpConnectorTool[];
    truncated: boolean;
  } {
    const raw = Array.isArray(result.tools) ? result.tools : [];
    const tools = raw.flatMap((entry): McpConnectorTool[] => {
      if (!isRecord(entry) || typeof entry.name !== 'string') return [];
      const name = entry.name.trim();
      if (name === '' || name.length > CONNECTOR_TOOL_NAME_MAX) return [];
      const annotations = isRecord(entry.annotations) ? entry.annotations : {};
      const title = typeof entry.title === 'string' ? entry.title.slice(0, 200) : undefined;
      return [
        {
          name,
          ...(title ? { title } : {}),
          description:
            typeof entry.description === 'string' ? entry.description.slice(0, 2000) : '',
          inputSchema: isRecord(entry.inputSchema)
            ? entry.inputSchema
            : { type: 'object', properties: {} },
          // Hint yang hilang dianggap menulis (docs/DESIGN_MCP_KONEKTOR.md bagian 5).
          readOnly: annotations.readOnlyHint === true,
        },
      ];
    });
    return {
      tools: tools.slice(0, CONNECTOR_TOOLS_MAX),
      truncated: tools.length > CONNECTOR_TOOLS_MAX,
    };
  }

  return {
    async probe(target, signal) {
      const url = parseConnectorUrl(target.url, policy);
      const session = await initialize(url, target, signal);
      const { result } = await rpc(url, target, session, 'tools/list', {}, signal);
      return { session, ...toolsOf(result) };
    },

    async callTool(connectorId, target, name, args, signal) {
      const url = parseConnectorUrl(target.url, policy);
      const run = async (session: ConnectorSession) =>
        rpc(url, target, session, 'tools/call', { name, arguments: args }, signal);

      let session = sessions.get(connectorId);
      if (!session) {
        session = await initialize(url, target, signal);
        sessions.set(connectorId, session);
      }
      let result: Record<string, unknown>;
      try {
        ({ result } = await run(session));
      } catch (error) {
        // Sesi kedaluwarsa: satu kali handshake ulang, lalu menyerah.
        if (!(error instanceof ConnectorError) || error.code !== 'connector_session_lost')
          throw error;
        sessions.delete(connectorId);
        const fresh = await initialize(url, target, signal);
        sessions.set(connectorId, fresh);
        ({ result } = await run(fresh));
      }
      return {
        content: Array.isArray(result.content) ? result.content : [],
        isError: result.isError === true,
      };
    },

    forget(connectorId) {
      sessions.delete(connectorId);
    },
  };
}
