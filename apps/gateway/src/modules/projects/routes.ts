import {
  CreateProjectRequestSchema,
  IdParamsSchema,
  UpdateProjectRequestSchema,
} from '@aios/contracts';
import type { FastifyPluginCallback } from 'fastify';
import { requireAuth, requireScope } from '../auth/guard.js';
import type { ProjectsService } from './service.js';

/** Project dikelola dari klien aplikasi: scope `app`. */
export const projectRoutes: FastifyPluginCallback<{ projects: ProjectsService }> = (
  app,
  { projects },
  done,
) => {
  const guard = { onRequest: requireScope('app') };

  app.get('/projects', guard, async () => ({ items: await projects.list() }));

  app.post('/projects', guard, async (req, reply) =>
    reply
      .code(201)
      .send(
        await projects.create(
          requireAuth(req).deviceId,
          CreateProjectRequestSchema.parse(req.body),
        ),
      ),
  );

  app.patch('/projects/:id', guard, (req) =>
    projects.update(
      requireAuth(req).deviceId,
      IdParamsSchema.parse(req.params).id,
      UpdateProjectRequestSchema.parse(req.body),
    ),
  );

  done();
};
