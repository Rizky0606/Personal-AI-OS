import { HealthSchema, ReadinessSchema } from '@aios/contracts';
import type { FastifyPluginCallback } from 'fastify';
import type { HealthService } from './service.js';

/** GET /healthz (proses hidup) dan GET /readyz (dependensi terjangkau). Keduanya tanpa auth. */
export const healthRoutes: FastifyPluginCallback<{ health: HealthService }> = (app, opts, done) => {
  // Dipantau Uptime Kuma terus-menerus, jadi tidak ikut rate limit.
  const unlimited = { config: { rateLimit: false as const } };

  app.get('/healthz', unlimited, () => HealthSchema.parse({ status: 'ok' }));

  app.get('/readyz', unlimited, async (_req, reply) => {
    const readiness = ReadinessSchema.parse(await opts.health.readiness());
    return reply.code(readiness.status === 'ok' ? 200 : 503).send(readiness);
  });

  done();
};
