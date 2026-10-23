import { DeviceListSchema, IdParamsSchema, PushTokenRequestSchema } from '@aios/contracts';
import type { FastifyPluginCallback } from 'fastify';
import { requireAuth, requireScope } from '../auth/guard.js';
import type { DevicesService } from './service.js';

/** Semua endpoint perangkat butuh scope `app`. */
export const deviceRoutes: FastifyPluginCallback<{ devices: DevicesService }> = (
  app,
  opts,
  done,
) => {
  const guard = { onRequest: requireScope('app') };

  app.get('/devices', guard, async () =>
    DeviceListSchema.parse({ items: await opts.devices.list() }),
  );

  app.delete('/devices/:id', guard, async (req, reply) => {
    const { id } = IdParamsSchema.parse(req.params);
    await opts.devices.revoke(requireAuth(req).deviceId, id);
    return reply.code(204).send();
  });

  app.post('/devices/:id/push-token', guard, async (req, reply) => {
    const { id } = IdParamsSchema.parse(req.params);
    const { pushToken } = PushTokenRequestSchema.parse(req.body);
    await opts.devices.setPushToken(requireAuth(req).deviceId, id, pushToken);
    return reply.code(204).send();
  });

  done();
};
