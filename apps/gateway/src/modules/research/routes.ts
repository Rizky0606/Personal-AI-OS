import {
  CreateResearchRequestSchema,
  IdParamsSchema,
  PageQuerySchema,
  ResearchExportQuerySchema,
} from '@aios/contracts';
import type { FastifyPluginCallback } from 'fastify';
import { requireScope } from '../auth/guard.js';
import type { ResearchService } from './service.js';

/** Riset dipakai klien aplikasi: scope `app`. */
export const researchRoutes: FastifyPluginCallback<{ research: ResearchService }> = (
  app,
  { research },
  done,
) => {
  const guard = { onRequest: requireScope('app') };

  app.post('/research', guard, async (req, reply) =>
    reply.code(201).send(await research.create(CreateResearchRequestSchema.parse(req.body))),
  );

  app.get('/research', guard, (req) => {
    const q = PageQuerySchema.parse(req.query);
    return research.list({ before: q.before, limit: q.limit });
  });

  app.get('/research/:id', guard, (req) => research.get(IdParamsSchema.parse(req.params).id));

  app.post('/research/:id/cancel', guard, (req) =>
    research.cancel(IdParamsSchema.parse(req.params).id),
  );

  app.get('/research/:id/export', guard, async (req, reply) => {
    const { id } = IdParamsSchema.parse(req.params);
    const { format } = ResearchExportQuerySchema.parse(req.query);
    const file = await research.export(id, format);
    return reply
      .header('content-type', file.contentType)
      .header('content-disposition', `attachment; filename="${file.filename}"`)
      .header('cache-control', 'no-store')
      .send(file.body);
  });

  done();
};
