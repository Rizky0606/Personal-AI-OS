import { RouteDecisionSchema, RoutePreviewRequestSchema } from '@aios/contracts';
import type { FastifyPluginCallback } from 'fastify';
import { requireScope } from '../auth/guard.js';
import type { RoutingService } from './service.js';

/** `POST /route/preview`: uji router tanpa menjalankan agent dan tanpa menyimpan apa pun. */
export const routerRoutes: FastifyPluginCallback<{ routing: RoutingService }> = (
  app,
  { routing },
  done,
) => {
  app.post('/route/preview', { onRequest: requireScope('app') }, async (req) => {
    const result = await routing.preview(RoutePreviewRequestSchema.parse(req.body));
    return RouteDecisionSchema.parse(result.decision);
  });
  done();
};
