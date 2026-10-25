import {
  CreateMemoryRequestSchema,
  IdParamsSchema,
  MemoryListSchema,
  UpdateMemoryRequestSchema,
} from '@aios/contracts';
import type { FastifyPluginCallback } from 'fastify';
import { requireScope } from '../auth/guard.js';
import type { MemoryService } from './service.js';

/** Memori dikelola dari klien aplikasi: scope `app`. */
export const memoryRoutes: FastifyPluginCallback<{ memory: MemoryService }> = (
  app,
  { memory },
  done,
) => {
  const guard = { onRequest: requireScope('app') };

  app.get('/memories', guard, async () => MemoryListSchema.parse({ items: await memory.list() }));

  app.post('/memories', guard, async (req, reply) =>
    reply.code(201).send(await memory.create(CreateMemoryRequestSchema.parse(req.body))),
  );

  app.patch('/memories/:id', guard, (req) =>
    memory.update(IdParamsSchema.parse(req.params).id, UpdateMemoryRequestSchema.parse(req.body)),
  );

  app.delete('/memories/:id', guard, async (req, reply) => {
    await memory.remove(IdParamsSchema.parse(req.params).id);
    return reply.code(204).send();
  });

  done();
};
