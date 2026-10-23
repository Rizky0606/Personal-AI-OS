import { IdSchema, type Usage } from '@aios/contracts';
import type { FastifyPluginAsync } from 'fastify';
import { pipeline, Readable } from 'node:stream';
import { AppError } from '../../errors.js';
import { authenticateHook, requireAuth, requireScope } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import type { NineRouterClient } from './client.js';
import { SseUsageTap, usageFromPayload, type UsageRecorder } from './usage.js';

/** Dipasang di root, bukan di bawah /v1, supaya base URL provider omp adalah `https://<domain>/llm/v1`. */
export const LLM_PREFIX = '/llm/v1';
/** Worker menyebut run mana yang memakai model, agar usage tercatat di run itu. */
export const RUN_ID_HEADER = 'x-aios-run-id';

const MAX_BODY_BYTES = 25 * 1024 * 1024;
export const DEFAULT_STREAM_IDLE_MS = 120_000;

/** Hanya header ini yang diteruskan. Authorization perangkat, cookie, dan X-Forwarded-* tidak pernah ikut. */
const REQUEST_HEADERS = ['content-type', 'accept', 'openai-beta', 'anthropic-version'] as const;
const RESPONSE_HEADERS = ['content-type', 'cache-control', 'retry-after'] as const;

export interface LlmProxyDeps {
  auth: AuthService;
  client: NineRouterClient;
  usage: UsageRecorder;
  streamIdleMs?: number;
}

/** Meminta 9Router mengirim usage di akhir stream; tanpa ini chat streaming tidak punya angka pemakaian. */
function withStreamUsage(body: Buffer): Buffer {
  try {
    const json = JSON.parse(body.toString('utf8')) as unknown;
    if (typeof json !== 'object' || json === null || Array.isArray(json)) return body;
    const obj = json as Record<string, unknown>;
    if (obj.stream !== true) return body;
    const existing =
      typeof obj.stream_options === 'object' && obj.stream_options !== null
        ? obj.stream_options
        : {};
    return Buffer.from(
      JSON.stringify({ ...obj, stream_options: { ...existing, include_usage: true } }),
    );
  } catch {
    // Bukan JSON: biarkan 9Router yang menolaknya dengan pesannya sendiri.
    return body;
  }
}

export const llmProxyRoutes: FastifyPluginAsync<LlmProxyDeps> = (app, deps) => {
  const { client, usage, streamIdleMs = DEFAULT_STREAM_IDLE_MS } = deps;

  // Body diteruskan apa adanya (JSON, multipart audio): jangan di-parse oleh Fastify.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

  app.addHook('onRequest', authenticateHook(deps.auth));
  app.addHook('onRequest', requireScope('llm'));

  app.route({
    method: ['GET', 'POST'],
    url: '/*',
    bodyLimit: MAX_BODY_BYTES,
    handler: async (req, reply) => {
      const { deviceId } = requireAuth(req);
      const rest = req.url.slice(LLM_PREFIX.length);
      const pathname = rest.split('?')[0] ?? '';

      let runId: string | undefined;
      if (req.headers[RUN_ID_HEADER] !== undefined) {
        const parsed = IdSchema.safeParse(req.headers[RUN_ID_HEADER]);
        if (!parsed.success) {
          throw new AppError(400, 'invalid_run_id', `Header ${RUN_ID_HEADER} harus berisi ID run.`);
        }
        runId = parsed.data;
      }

      let body = Buffer.isBuffer(req.body) ? req.body : undefined;
      const isJson = (req.headers['content-type'] ?? '').includes('json');
      if (body && isJson && req.method === 'POST' && pathname === '/chat/completions') {
        body = withStreamUsage(body);
      }

      const headers: Record<string, string> = {};
      for (const name of REQUEST_HEADERS) {
        const value = req.headers[name];
        if (typeof value === 'string') headers[name] = value;
      }

      // Klien memutus koneksi (mis. omp di-cancel): hentikan juga panggilan model yang berbayar.
      const abort = new AbortController();
      reply.raw.on('close', () => {
        if (!reply.raw.writableFinished) abort.abort();
      });

      const record = (found: Usage | null) => {
        req.log.info(
          {
            deviceId,
            runId,
            path: pathname,
            inputTokens: found?.inputTokens,
            outputTokens: found?.outputTokens,
          },
          'llm proxy selesai',
        );
        if (!found || !runId) return;
        usage
          .record(runId, found)
          .then((exists) => {
            if (!exists) req.log.warn({ runId }, 'run tidak ditemukan, usage tidak dicatat');
          })
          .catch((err: unknown) => req.log.warn({ err, runId }, 'gagal mencatat usage'));
      };

      let upstream: Response;
      try {
        upstream = await client.request(rest, {
          method: req.method,
          headers,
          ...(body ? { body } : {}),
          signal: abort.signal,
        });
      } catch (err) {
        if (abort.signal.aborted) return reply.code(499).send();
        throw err;
      }

      // 401/403 dari 9Router berarti API key gateway salah; jangan menyamar sebagai token perangkat kedaluwarsa.
      if (upstream.status === 401 || upstream.status === 403) {
        await upstream.body?.cancel();
        req.log.warn({ status: upstream.status }, 'API key 9Router ditolak');
        throw new AppError(502, 'llm_upstream_auth', 'Gateway ditolak oleh layanan model.');
      }

      void reply.code(upstream.status);
      for (const name of RESPONSE_HEADERS) {
        const value = upstream.headers.get(name);
        if (value) void reply.header(name, value);
      }
      const contentType = upstream.headers.get('content-type') ?? '';

      if (!upstream.body) {
        record(null);
        return reply.send();
      }

      if (contentType.includes('text/event-stream')) {
        const tap = new SseUsageTap(record, {
          ms: streamIdleMs,
          onIdle: () => abort.abort(),
        });
        pipeline(Readable.fromWeb(upstream.body), tap, () => undefined);
        // Cegah nginx menahan event sampai buffer penuh.
        void reply.header('x-accel-buffering', 'no');
        return reply.send(tap);
      }

      if (contentType.includes('json')) {
        const payload = Buffer.from(await upstream.arrayBuffer());
        try {
          record(usageFromPayload(JSON.parse(payload.toString('utf8'))));
        } catch {
          record(null);
        }
        return reply.send(payload);
      }

      record(null);
      return reply.send(Readable.fromWeb(upstream.body));
    },
  });

  return Promise.resolve();
};
