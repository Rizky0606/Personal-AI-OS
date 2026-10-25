import { SearchQuerySchema, SearchResponseSchema } from '@aios/contracts';
import type { FastifyPluginCallback } from 'fastify';
import { requireScope } from '../auth/guard.js';
import type { SearchService } from './service.js';

/** Pencarian riwayat dari klien aplikasi: scope `app`. */
export const searchRoutes: FastifyPluginCallback<{ search: SearchService }> = (
  app,
  { search },
  done,
) => {
  app.get('/search', { onRequest: requireScope('app') }, async (req) => {
    const { q, limit } = SearchQuerySchema.parse(req.query);
    return SearchResponseSchema.parse({ items: await search.search(q, limit) });
  });
  done();
};
