import { IdSchema, RUN_ID_HEADER } from '@aios/contracts';
import type { FastifyPluginCallback } from 'fastify';
import type { Database } from '../../db/client.js';
import { AppError } from '../../errors.js';
import { writeAudit } from '../audit/repo.js';
import { requireAuth, requireScope } from '../auth/guard.js';
import type { ProjectsService } from '../projects/service.js';
import type { RunsService } from '../runs/service.js';
import type { McpServer } from './server.js';

/** Sama dengan server MCP browser worker: pesan JSON-RPC kecil, bukan unggahan. */
export const MCP_MAX_BODY_BYTES = 256 * 1024;

export interface McpRouteOptions {
  server: McpServer;
  runs: Pick<RunsService, 'get' | 'projectId'>;
  projects: Pick<ProjectsService, 'workerOf'>;
  db: Pick<Database, 'insert'>;
  /** Batas POST /mcp per menit per perangkat worker. */
  perMinute: number;
}

/**
 * `POST /v1/mcp`: server MCP `aios_tools` untuk agent di worker. Hanya token scope `worker` dengan
 * `X-Aios-Run-Id` (disisipkan relay worker, bukan omp) milik run yang sedang berjalan di project worker itu,
 * pola yang sama dengan unggah screenshot (`worker/artifacts.ts`). Setiap panggilan tool dicatat di log dan
 * audit tanpa argumen atau isi.
 */
export const mcpRoutes: FastifyPluginCallback<McpRouteOptions> = (app, opts, done) => {
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
    keyGenerator: (req: { auth?: { deviceId: string }; ip: string }) =>
      `mcp:${req.auth?.deviceId ?? req.ip}`,
  };

  app.post(
    '/mcp',
    { onRequest: requireScope('worker'), bodyLimit: MCP_MAX_BODY_BYTES, config: { rateLimit } },
    async (req, reply) => {
      const auth = requireAuth(req);
      const header = req.headers[RUN_ID_HEADER];
      if (header === undefined) {
        throw new AppError(400, 'missing_run_id', `Header ${RUN_ID_HEADER} wajib ada.`);
      }
      const parsedRun = IdSchema.safeParse(header);
      if (!parsedRun.success) {
        throw new AppError(400, 'invalid_run_id', `Header ${RUN_ID_HEADER} harus berisi ID run.`);
      }
      const runId = parsedRun.data;
      const projectId = await opts.runs.projectId(runId);
      if (!projectId || (await opts.projects.workerOf(projectId)) !== auth.deviceId)
        throw new AppError(403, 'run_not_owned', 'Run ini bukan milik worker ini.');
      const run = await opts.runs.get(runId);
      if (run.status !== 'running')
        throw new AppError(409, 'run_not_active', 'Run ini tidak sedang berjalan di gateway.');

      const abort = new AbortController();
      reply.raw.on('close', () => {
        if (!reply.raw.writableFinished) abort.abort();
      });
      // Audit selesai sebelum jawaban dikirim; kegagalan audit dicatat tanpa menggagalkan panggilan tool.
      const audits: Promise<void>[] = [];
      const result = await opts.server.handle(typeof req.body === 'string' ? req.body : '', {
        runId,
        projectId,
        signal: abort.signal,
        onToolCall: (record) => {
          req.log.info({ deviceId: auth.deviceId, runId, ...record }, 'mcp tool selesai');
          audits.push(
            writeAudit(opts.db, {
              actorDeviceId: auth.deviceId,
              action: 'mcp.tool_called',
              target: `run:${runId} tool:${record.tool} ${record.ok ? 'ok' : 'error'}`,
            }).catch((err: unknown) => req.log.warn({ err, runId }, 'gagal menulis audit mcp')),
          );
        },
      });
      await Promise.all(audits);
      if (result.body === undefined) return reply.code(result.status).send();
      return reply.code(result.status).type('application/json').send(JSON.stringify(result.body));
    },
  );

  // Tanpa aliran SSE dari server dan tanpa sesi (spesifikasi Streamable HTTP mengizinkan keduanya).
  app.get('/mcp', { onRequest: requireScope('worker') }, () =>
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
  app.delete('/mcp', { onRequest: requireScope('worker') }, async (_req, reply) =>
    reply.code(204).send(),
  );
  done();
};
