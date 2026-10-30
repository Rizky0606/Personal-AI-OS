import { IdParamsSchema, TeamRequestSchema } from '@aios/contracts';
import type { FastifyPluginCallback } from 'fastify';
import { requireScope } from '../auth/guard.js';
import type { TeamsService } from './service.js';

export const teamRoutes: FastifyPluginCallback<{ teams: TeamsService }> = (app, { teams }, done) => {
  const guard = { onRequest: requireScope('app') };
  app.post('/teams', guard, async (req, reply) => reply.code(201).send(await teams.create(TeamRequestSchema.parse(req.body))));
  app.get('/teams', guard, () => teams.list());
  app.get('/teams/:id', guard, (req) => teams.get(IdParamsSchema.parse(req.params).id));
  app.post('/teams/:id/cancel', guard, (req) => teams.cancel(IdParamsSchema.parse(req.params).id));
  done();
};
