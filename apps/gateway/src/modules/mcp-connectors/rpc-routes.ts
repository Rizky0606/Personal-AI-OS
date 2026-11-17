import { IdSchema } from '@aios/contracts';
import type { FastifyPluginCallback, FastifyRequest } from 'fastify';
import type { Database } from '../../db/client.js';
import { AppError } from '../../errors.js';
import { authenticateHook, requireScope } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import { MCP_MAX_BODY_BYTES } from '../mcp/routes.js';
import { requireWorkerRun, type RunBindingDeps } from '../mcp/run-binding.js';
import type { ConnectorMcpServer } from './server.js';
import type { McpConnectorService } from './service.js';

export interface McpConnectorRpcOptions extends RunBindingDeps {
  server: ConnectorMcpServer;
  connectors: Pick<McpConnectorService, 'resolveEnabled'>;
  auth: AuthService;
  db: Pick<Database, 'insert'>;
  /** Batas POST per menit per perangkat worker; sama dengan zona `/v1/mcp`. */
  perMinute: number;
}

/**
 * `POST /v1/mcp/connector/:id`: server MCP per konektor untuk relay worker (docs/DESIGN_MCP_KONEKTOR.md
 * bagian 3). Hanya token worker dengan `X-Aios-Run-Id` run yang sedang berjalan di project worker itu.
 * Konektor yang mati atau tidak ada dijawab 404 supaya keberadaannya tidak bisa diraba dari worker.
 */
export const mcpConnectorRpcRoutes: FastifyPluginCallback<McpConnectorRpcOptions> = (
  app,
  opts,
  done,
) => {
  const authenticate = authenticateHook(opts.auth);
  const workerScope = requireScope('worker');

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
    keyGenerator: (req: FastifyRequest) => `mcp:${req.auth?.deviceId ?? req.ip}`,
  };

  app.post<{ Params: { id: string } }>(
    '/mcp/connector/:id',
    {
      onRequest: [authenticate, workerScope],
      bodyLimit: MCP_MAX_BODY_BYTES,
      config: { rateLimit },
    },
    async (req, reply) => {
      const parsedId = IdSchema.safeParse(req.params.id);
      if (!parsedId.success)
        throw new AppError(404, 'connector_not_found', 'Konektor itu tidak ada.');
      const run = await requireWorkerRun(req, opts);
      const connector = await opts.connectors.resolveEnabled(parsedId.data);
      if (!connector)
        throw new AppError(404, 'connector_not_found', 'Konektor itu tidak aktif untuk run ini.');

      const abort = new AbortController();
      reply.raw.on('close', () => {
        if (!reply.raw.writableFinished) abort.abort();
      });
      const result = await opts.server.handle(typeof req.body === 'string' ? req.body : '', {
        connector,
        runId: run.runId,
        planOnly: run.planOnly,
        deviceId: run.deviceId,
        signal: abort.signal,
        onToolCall: (record) =>
          // Tanpa argumen, tanpa isi hasil, tanpa URL konektor.
          req.log.info(
            { connectorId: connector.id, runId: run.runId, deviceId: run.deviceId, ...record },
            'tool konektor selesai',
          ),
      });
      if (result.body === undefined) return reply.code(result.status).send();
      return reply.code(result.status).type('application/json').send(JSON.stringify(result.body));
    },
  );

  done();
};
