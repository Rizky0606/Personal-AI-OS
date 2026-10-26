import { OpinionRequestSchema, OpinionResponseSchema } from '@aios/contracts';
import type { FastifyPluginCallback } from 'fastify';
import { requireScope } from '../auth/guard.js';
import type { OpinionService } from './service.js';

/** Pendapat kedua dipakai dari klien aplikasi: scope `app`. */
export const opinionRoutes: FastifyPluginCallback<{ opinion: OpinionService }> = (
  app,
  { opinion },
  done,
) => {
  app.post('/review/opinion', { onRequest: requireScope('app') }, async (req) => {
    const controller = new AbortController();
    // Klien menutup koneksi: panggilan ke model dihentikan.
    req.raw.on('close', () => {
      if (!req.raw.complete) controller.abort();
    });
    return OpinionResponseSchema.parse(
      await opinion.run(OpinionRequestSchema.parse(req.body), controller.signal),
    );
  });
  done();
};
