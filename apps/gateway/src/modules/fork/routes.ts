import { IdParamsSchema } from '@aios/contracts';
import type { FastifyPluginCallback } from 'fastify';
import { requireScope } from '../auth/guard.js';
import type { ForkService } from './service.js';

/** Cabang percakapan dipakai dari klien aplikasi: scope `app`. */
export const forkRoutes: FastifyPluginCallback<{ fork: ForkService }> = (app, { fork }, done) => {
  app.post('/messages/:id/fork', { onRequest: requireScope('app') }, async (req, reply) =>
    reply.code(201).send(await fork.fork(IdParamsSchema.parse(req.params).id)),
  );
  done();
};
