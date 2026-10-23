import { RoleListSchema } from '@aios/contracts';
import type { FastifyPluginCallback } from 'fastify';
import { requireScope } from '../auth/guard.js';
import type { RolesService } from './service.js';

/** Daftar role dibaca klien aplikasi (chip role, pemilih role): scope `app`. */
export const roleRoutes: FastifyPluginCallback<{ roles: RolesService }> = (
  app,
  { roles },
  done,
) => {
  app.get('/roles', { onRequest: requireScope('app') }, () =>
    RoleListSchema.parse({ items: roles.list() }),
  );
  done();
};
