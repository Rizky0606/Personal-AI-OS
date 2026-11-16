import {
  ApproveMemoryProposalRequestSchema,
  CreateMemoryRequestSchema,
  IdParamsSchema,
  MemoryListSchema,
  MemoryProposalListSchema,
  MemoryProposalQuerySchema,
  UpdateMemoryRequestSchema,
} from '@aios/contracts';
import type { FastifyPluginCallback } from 'fastify';
import { requireScope } from '../auth/guard.js';
import type { MemoryProposalService } from './proposal-service.js';
import type { MemoryService } from './service.js';

/** Memori dan usulan memori dikelola dari klien aplikasi: scope `app`. */
export const memoryRoutes: FastifyPluginCallback<{
  memory: MemoryService;
  proposals: MemoryProposalService;
}> = (app, { memory, proposals }, done) => {
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

  app.get('/memories/proposals', guard, async (req) =>
    MemoryProposalListSchema.parse({
      items: await proposals.list(MemoryProposalQuerySchema.parse(req.query)),
    }),
  );

  app.post('/memories/proposals/:id/approve', guard, (req) =>
    proposals.approve(
      IdParamsSchema.parse(req.params).id,
      ApproveMemoryProposalRequestSchema.parse(req.body ?? {}),
    ),
  );

  app.post('/memories/proposals/:id/reject', guard, (req) =>
    proposals.reject(IdParamsSchema.parse(req.params).id),
  );

  app.post('/memories/proposals/:id/undo', guard, (req) =>
    proposals.undo(IdParamsSchema.parse(req.params).id),
  );

  done();
};
