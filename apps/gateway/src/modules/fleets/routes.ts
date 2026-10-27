import { FleetRequestSchema } from '@aios/contracts';
import type { FastifyPluginCallback } from 'fastify';
import { requireScope } from '../auth/guard.js';
import type { FleetService } from './service.js';

/** Armada agent dipakai dari klien aplikasi: scope `app`. */
export const fleetRoutes: FastifyPluginCallback<{ fleets: FleetService }> = (
  app,
  { fleets },
  done,
) => {
  app.post('/fleets', { onRequest: requireScope('app') }, async (req, reply) =>
    reply.code(201).send(await fleets.launch(FleetRequestSchema.parse(req.body))),
  );
  done();
};
