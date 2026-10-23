import { ProblemSchema, PROBLEM_CONTENT_TYPE, type Problem } from '@aios/contracts';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

const TITLES: Record<number, string> = {
  400: 'Permintaan tidak valid',
  401: 'Autentikasi gagal',
  403: 'Tidak diizinkan',
  404: 'Tidak ditemukan',
  405: 'Method tidak didukung',
  409: 'Konflik dengan status saat ini',
  413: 'Isi permintaan terlalu besar',
  415: 'Jenis konten tidak didukung',
  422: 'Tidak bisa diproses',
  429: 'Terlalu banyak permintaan',
  500: 'Kesalahan server',
  503: 'Layanan tidak tersedia',
};

const problemType = (code: string) => `urn:aios:problem:${code}`;

/** Error domain dengan `code` yang stabil; route dan service melempar ini, bukan string bebas. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    detail: string,
    readonly errors?: Problem['errors'],
    readonly headers?: Record<string, string>,
  ) {
    super(detail);
    this.name = 'AppError';
  }
}

function buildProblem(
  status: number,
  code: string,
  detail: string,
  requestId: string,
  errors?: Problem['errors'],
): Problem {
  return ProblemSchema.parse({
    type: problemType(code),
    title: TITLES[status] ?? (status >= 500 ? 'Kesalahan server' : 'Permintaan gagal'),
    status,
    detail,
    code,
    instance: `urn:aios:request:${requestId}`,
    ...(errors?.length ? { errors } : {}),
  });
}

function sendProblem(
  reply: FastifyReply,
  problem: Problem,
  headers: Record<string, string> = {},
): FastifyReply {
  return reply
    .code(problem.status)
    .headers(headers)
    .header('content-type', PROBLEM_CONTENT_TYPE)
    .send(problem);
}

/** Kode Fastify seperti FST_ERR_CTP_INVALID_MEDIA_TYPE menjadi `ctp_invalid_media_type`. */
const fastifyCode = (code: string) => code.replace(/^FST_ERR_/, '').toLowerCase();

function isFastifyClientError(err: unknown): err is FastifyError & { statusCode: number } {
  const e = err as Partial<FastifyError> | null;
  return !!e && typeof e.statusCode === 'number' && e.statusCode >= 400 && e.statusCode < 500;
}

export function registerErrorHandling(app: FastifyInstance): void {
  app.setNotFoundHandler((req: FastifyRequest, reply) =>
    sendProblem(
      reply,
      buildProblem(
        404,
        'route_not_found',
        `Tidak ada endpoint ${req.method} ${(req.url.split('?')[0] ?? '').slice(0, 200)}.`,
        req.id,
      ),
    ),
  );

  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof AppError) {
      if (err.status >= 500) req.log.error({ err }, 'app error');
      return sendProblem(
        reply,
        buildProblem(err.status, err.code, err.message, req.id, err.errors),
        err.headers,
      );
    }

    if (err instanceof ZodError) {
      const errors = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
      return sendProblem(
        reply,
        buildProblem(
          400,
          'validation_failed',
          'Data permintaan tidak sesuai skema.',
          req.id,
          errors,
        ),
      );
    }

    if (isFastifyClientError(err)) {
      return sendProblem(
        reply,
        buildProblem(err.statusCode, fastifyCode(err.code ?? 'bad_request'), err.message, req.id),
      );
    }

    // Kesalahan tak terduga: catat lengkap di log, jangan bocorkan detail ke klien.
    req.log.error({ err }, 'unhandled error');
    return sendProblem(
      reply,
      buildProblem(
        500,
        'internal_error',
        'Terjadi kesalahan di server. Sertakan requestId saat melapor.',
        req.id,
      ),
    );
  });
}
