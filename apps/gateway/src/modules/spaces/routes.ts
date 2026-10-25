import {
  AddSpaceDocumentRequestSchema,
  CreateSpaceRequestSchema,
  IdParamsSchema,
  SpaceDocumentListSchema,
  SpaceDocumentParamsSchema,
  SpaceListSchema,
  UpdateSpaceRequestSchema,
} from '@aios/contracts';
import type { FastifyPluginCallback } from 'fastify';
import { requireScope } from '../auth/guard.js';
import type { SpacesService } from './service.js';

/** Ruang pengetahuan dikelola dari klien aplikasi: scope `app`. */
export const spaceRoutes: FastifyPluginCallback<{ spaces: SpacesService }> = (
  app,
  { spaces },
  done,
) => {
  const guard = { onRequest: requireScope('app') };

  app.get('/spaces', guard, async () => SpaceListSchema.parse({ items: await spaces.list() }));

  app.post('/spaces', guard, async (req, reply) =>
    reply.code(201).send(await spaces.create(CreateSpaceRequestSchema.parse(req.body))),
  );

  app.patch('/spaces/:id', guard, (req) =>
    spaces.update(IdParamsSchema.parse(req.params).id, UpdateSpaceRequestSchema.parse(req.body)),
  );

  app.delete('/spaces/:id', guard, async (req, reply) => {
    await spaces.remove(IdParamsSchema.parse(req.params).id);
    return reply.code(204).send();
  });

  app.get('/spaces/:id/documents', guard, async (req) =>
    SpaceDocumentListSchema.parse({
      items: await spaces.documents(IdParamsSchema.parse(req.params).id),
    }),
  );

  app.post('/spaces/:id/documents', guard, async (req, reply) => {
    const { id } = IdParamsSchema.parse(req.params);
    const { fileId } = AddSpaceDocumentRequestSchema.parse(req.body);
    return reply.code(201).send(await spaces.addDocument(id, fileId));
  });

  app.delete('/spaces/:id/documents/:documentId', guard, async (req, reply) => {
    const { id, documentId } = SpaceDocumentParamsSchema.parse(req.params);
    await spaces.removeDocument(id, documentId);
    return reply.code(204).send();
  });

  done();
};
