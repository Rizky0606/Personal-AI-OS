import { CompareRequestSchema, CompareResponseSchema } from '@aios/contracts';
import type { FastifyPluginCallback } from 'fastify';
import { requireScope } from '../auth/guard.js';
import type { CompareService } from './service.js';

/** Pembanding model dipakai dari klien aplikasi: scope `app`. */
export const compareRoutes: FastifyPluginCallback<{ compare: CompareService }> = (
  app,
  { compare },
  done,
) => {
  app.post('/compare', { onRequest: requireScope('app') }, async (req) => {
    const controller = new AbortController();
    // Klien menutup koneksi: panggilan ke model dihentikan.
    req.raw.on('close', () => {
      if (!req.raw.complete) controller.abort();
    });
    return CompareResponseSchema.parse(
      await compare.run(CompareRequestSchema.parse(req.body), controller.signal),
    );
  });
  done();
};
