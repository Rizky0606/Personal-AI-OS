import { SkillDetailSchema, SkillListSchema } from '@aios/contracts';
import type { FastifyPluginCallback } from 'fastify';
import { AppError } from '../../errors.js';
import { requireAnyScope } from '../auth/guard.js';
import type { SkillsService } from './service.js';

/**
 * Katalog skill (P9): indeks tanpa isi (`GET /skills`) dan isi lengkap satu skill (`GET /skills/:id`).
 * Dipakai klien (menampilkan apa yang tersedia) dan worker (menyinkronkan folder skill omp) -- scope `app`
 * atau `worker`, bukan `llm` (proxy model tidak perlu ini).
 */
export const skillRoutes: FastifyPluginCallback<{ skills: SkillsService }> = (
  app,
  { skills },
  done,
) => {
  app.get('/skills', { onRequest: requireAnyScope('app', 'worker') }, () =>
    SkillListSchema.parse({ items: skills.list() }),
  );

  app.get<{ Params: { id: string } }>(
    '/skills/:id',
    { onRequest: requireAnyScope('app', 'worker') },
    (req) => {
      const skill = skills.get(req.params.id);
      if (!skill) throw new AppError(404, 'skill_not_found', `Skill "${req.params.id}" tidak ada.`);
      return SkillDetailSchema.parse(skill);
    },
  );
  done();
};
