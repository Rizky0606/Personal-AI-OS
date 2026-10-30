import { EngineListSchema, ModelListSchema, QuotaSchema, type EngineInfo } from '@aios/contracts';
import type { FastifyPluginCallback } from 'fastify';
import { requireScope } from '../auth/guard.js';
import type { ModelsService } from './models.js';
import type { QuotaService } from './usage.js';

/** Daftar model dan kuota dibaca klien aplikasi, jadi butuh scope `app`. */
export const catalogRoutes: FastifyPluginCallback<{
  models: ModelsService;
  quota: QuotaService;
  /** Engine yang bisa dipilih per pesan; tanpa ini daftar kosong. */
  engines?: () => EngineInfo[];
}> = (app, opts, done) => {
  const guard = { onRequest: requireScope('app') };

  app.get('/models', guard, async () => ModelListSchema.parse({ items: await opts.models.list() }));
  app.get('/engines', guard, () => EngineListSchema.parse({ items: opts.engines?.() ?? [] }));
  app.get('/quota', guard, async () => QuotaSchema.parse(await opts.quota.summary()));

  done();
};
