import { ModelListSchema, QuotaSchema } from '@aios/contracts';
import type { FastifyPluginCallback } from 'fastify';
import { requireScope } from '../auth/guard.js';
import type { ModelsService } from './models.js';
import type { QuotaService } from './usage.js';

/** Daftar model dan kuota dibaca klien aplikasi, jadi butuh scope `app`. */
export const catalogRoutes: FastifyPluginCallback<{
  models: ModelsService;
  quota: QuotaService;
}> = (app, opts, done) => {
  const guard = { onRequest: requireScope('app') };

  app.get('/models', guard, async () => ModelListSchema.parse({ items: await opts.models.list() }));
  app.get('/quota', guard, async () => QuotaSchema.parse(await opts.quota.summary()));

  done();
};
