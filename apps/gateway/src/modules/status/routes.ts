import { StatusSchema } from '@aios/contracts';
import type { FastifyPluginCallback } from 'fastify';
import { requireScope } from '../auth/guard.js';
import type { StatusService } from './service.js';

/** Halaman Status di aplikasi: scope `app`. Berbeda dari /readyz yang publik dan hanya untuk pemantau. */
export const statusRoutes: FastifyPluginCallback<{ status: StatusService }> = (app, opts, done) => {
  app.get('/status', { onRequest: requireScope('app') }, async () =>
    StatusSchema.parse(await opts.status.get()),
  );
  done();
};
