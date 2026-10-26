import { HandoffRequestSchema, IdParamsSchema } from '@aios/contracts';
import type { FastifyPluginCallback } from 'fastify';
import { requireScope } from '../auth/guard.js';
import type { HandoffService } from './service.js';

/** Lanjut dengan ringkasan dipakai dari klien aplikasi: scope `app`. */
export const handoffRoutes: FastifyPluginCallback<{ handoff: HandoffService }> = (
  app,
  { handoff },
  done,
) => {
  app.post('/conversations/:id/handoff', { onRequest: requireScope('app') }, async (req, reply) => {
    const controller = new AbortController();
    // Klien menutup koneksi: panggilan ke model dihentikan.
    req.raw.on('close', () => {
      if (!req.raw.complete) controller.abort();
    });
    const created = await handoff.run(
      IdParamsSchema.parse(req.params).id,
      HandoffRequestSchema.parse(req.body),
      controller.signal,
    );
    return reply.code(201).send(created);
  });
  done();
};
