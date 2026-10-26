import {
  CreatePromptTemplateRequestSchema,
  IdParamsSchema,
  PromptTemplateListSchema,
  UpdatePromptTemplateRequestSchema,
} from '@aios/contracts';
import type { FastifyPluginCallback } from 'fastify';
import { requireScope } from '../auth/guard.js';
import type { TemplateService } from './service.js';

/** Templat prompt dikelola dari klien aplikasi: scope `app`. */
export const templateRoutes: FastifyPluginCallback<{ templates: TemplateService }> = (
  app,
  { templates },
  done,
) => {
  const guard = { onRequest: requireScope('app') };

  app.get('/prompt-templates', guard, async () =>
    PromptTemplateListSchema.parse({ items: await templates.list() }),
  );

  app.post('/prompt-templates', guard, async (req, reply) =>
    reply.code(201).send(await templates.create(CreatePromptTemplateRequestSchema.parse(req.body))),
  );

  app.patch('/prompt-templates/:id', guard, (req) =>
    templates.update(
      IdParamsSchema.parse(req.params).id,
      UpdatePromptTemplateRequestSchema.parse(req.body),
    ),
  );

  app.delete('/prompt-templates/:id', guard, async (req, reply) => {
    await templates.remove(IdParamsSchema.parse(req.params).id);
    return reply.code(204).send();
  });

  done();
};
