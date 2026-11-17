import { createHash } from 'node:crypto';
import type { FastifyPluginCallback, FastifyRequest, onRequestAsyncHookHandler } from 'fastify';
import type { Database } from '../../db/client.js';
import { AppError } from '../../errors.js';
import { writeAudit } from '../audit/repo.js';
import { authenticateHook, requireScope } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import { hashesEqual } from '../auth/tokens.js';
import type { ProjectsService } from '../projects/service.js';
import type { RunsService } from '../runs/service.js';
import { requireWorkerRun } from './run-binding.js';
import type { McpCallContext, McpServer } from './server.js';
import { hermesContext, workerContext, type McpPrincipal } from './tools.js';

/** Sama dengan server MCP browser worker: pesan JSON-RPC kecil, bukan unggahan. */
export const MCP_MAX_BODY_BYTES = 256 * 1024;

declare module 'fastify' {
  interface FastifyRequest {
    /** Diisi hook auth `/v1/mcp`: `hermes` untuk token layanan Hermes, `worker` untuk token perangkat worker. */
    mcpPrincipal?: McpPrincipal;
  }
}

export interface McpRouteOptions {
  server: McpServer;
  auth: AuthService;
  runs: Pick<RunsService, 'get' | 'projectId'>;
  projects: Pick<ProjectsService, 'workerOf'>;
  db: Pick<Database, 'insert'>;
  /** Batas POST /mcp per menit per perangkat worker (dan untuk Hermes secara keseluruhan). */
  perMinute: number;
  /**
   * SHA-256 (heks) token layanan Hermes (`MCP_HERMES_TOKEN_SHA256`). Kosong = principal Hermes mati: token apa pun
   * selain JWT worker ditolak 401.
   */
  hermesTokenSha256?: string | undefined;
  now?: () => number;
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
/** Header yang dipasang reverse proxy; permintaan Hermes yang sah datang langsung ke 127.0.0.1:3000 tanpa proxy. */
const PROXY_HEADERS = ['x-forwarded-for', 'x-real-ip', 'forwarded'];

const bearer = (req: FastifyRequest): string | undefined =>
  /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '')?.[1];

/**
 * Langsung dari loopback, bukan lewat nginx: alamat soket (bukan `req.ip`, yang mengikuti `X-Forwarded-For` dari
 * proxy tepercaya) dan tanpa header proxy.
 */
const directLoopback = (req: FastifyRequest) =>
  LOOPBACK.has(req.socket.remoteAddress ?? '') &&
  PROXY_HEADERS.every((h) => req.headers[h] === undefined);

/**
 * `/v1/mcp`: server MCP `aios_tools`. Dua principal (docs/DESIGN_MCP_TOOLS.md bagian 5):
 * - `worker`: token scope `worker` dengan `X-Aios-Run-Id` (disisipkan relay worker, bukan omp) milik run yang sedang
 *   berjalan di project worker itu, pola yang sama dengan unggah screenshot (`worker/artifacts.ts`).
 * - `hermes`: token layanan opak yang SHA-256-nya sama dengan `MCP_HERMES_TOKEN_SHA256`, hanya langsung dari
 *   loopback tanpa header proxy; tanpa run, anggaran per jam, tanpa tool kanban.
 * Setiap panggilan tool dicatat di log dan audit tanpa argumen atau isi.
 */
export const mcpRoutes: FastifyPluginCallback<McpRouteOptions> = (app, opts, done) => {
  const now = opts.now ?? Date.now;
  const hermesHash = opts.hermesTokenSha256?.toLowerCase();
  const authenticate = authenticateHook(opts.auth);
  const workerScope = requireScope('worker');

  const guard: onRequestAsyncHookHandler = async function (req, reply) {
    const token = bearer(req);
    if (
      hermesHash &&
      token &&
      hashesEqual(createHash('sha256').update(token).digest('hex'), hermesHash)
    ) {
      if (!directLoopback(req)) {
        throw new AppError(
          403,
          'hermes_not_local',
          'Token layanan Hermes hanya diterima langsung dari loopback, bukan lewat proxy.',
        );
      }
      req.mcpPrincipal = 'hermes';
      return;
    }
    await authenticate.call(this, req, reply);
    await workerScope.call(this, req, reply);
    req.mcpPrincipal = 'worker';
  };

  // Isi dibaca mentah supaya JSON rusak dijawab galat JSON-RPC -32700, bukan Problem.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser(
    '*',
    { parseAs: 'string', bodyLimit: MCP_MAX_BODY_BYTES },
    (_req, body, next) => next(null, body),
  );

  const rateLimit = {
    max: opts.perMinute,
    timeWindow: '1 minute',
    keyGenerator: (req: FastifyRequest) =>
      req.mcpPrincipal === 'hermes' ? 'mcp:hermes' : `mcp:${req.auth?.deviceId ?? req.ip}`,
  };

  /** Konteks tool untuk worker: run harus milik worker ini dan sedang berjalan. */
  async function workerCall(req: FastifyRequest): Promise<McpCallContext> {
    const run = await requireWorkerRun(req, opts);
    return { ...workerContext(run.runId), ...run };
  }

  app.post(
    '/mcp',
    { onRequest: guard, bodyLimit: MCP_MAX_BODY_BYTES, config: { rateLimit } },
    async (req, reply) => {
      const base: McpCallContext =
        req.mcpPrincipal === 'hermes' ? hermesContext(now()) : await workerCall(req);
      const actor = base.deviceId ?? null;
      const subject = base.runId ? `run:${base.runId}` : 'hermes';

      const abort = new AbortController();
      reply.raw.on('close', () => {
        if (!reply.raw.writableFinished) abort.abort();
      });
      // Audit selesai sebelum jawaban dikirim; kegagalan audit dicatat tanpa menggagalkan panggilan tool.
      const audits: Promise<void>[] = [];
      const result = await opts.server.handle(typeof req.body === 'string' ? req.body : '', {
        ...base,
        signal: abort.signal,
        onToolCall: (record) => {
          req.log.info(
            { principal: base.principal, deviceId: actor, runId: base.runId, ...record },
            'mcp tool selesai',
          );
          audits.push(
            writeAudit(opts.db, {
              actorDeviceId: actor,
              action: 'mcp.tool_called',
              target: `${subject} tool:${record.tool} ${record.ok ? 'ok' : 'error'}`,
            }).catch((err: unknown) =>
              req.log.warn({ err, runId: base.runId }, 'gagal menulis audit mcp'),
            ),
          );
        },
      });
      await Promise.all(audits);
      if (result.body === undefined) return reply.code(result.status).send();
      return reply.code(result.status).type('application/json').send(JSON.stringify(result.body));
    },
  );

  // Tanpa aliran SSE dari server dan tanpa sesi (spesifikasi Streamable HTTP mengizinkan keduanya).
  app.get('/mcp', { onRequest: guard }, () =>
    Promise.reject(
      new AppError(
        405,
        'method_not_allowed',
        'Server MCP ini tidak menyediakan aliran SSE.',
        undefined,
        {
          allow: 'POST, DELETE',
        },
      ),
    ),
  );
  app.delete('/mcp', { onRequest: guard }, async (_req, reply) => reply.code(204).send());
  done();
};
