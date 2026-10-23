import {
  CreateScheduleRequestSchema,
  IdParamsSchema,
  PageQuerySchema,
  ScheduleParseRequestSchema,
  ScheduleParseResponseSchema,
  UpdateScheduleRequestSchema,
} from '@aios/contracts';
import type { FastifyPluginCallback } from 'fastify';
import { requireScope } from '../auth/guard.js';
import type { ScheduleService } from './service.js';

/** Jadwal dikelola dari klien aplikasi: scope `app`. */
export const scheduleRoutes: FastifyPluginCallback<{ schedules: ScheduleService }> = (
  app,
  { schedules },
  done,
) => {
  const guard = { onRequest: requireScope('app') };

  app.get('/schedules', guard, async () => ({ items: await schedules.list() }));

  app.post('/schedules', guard, async (req, reply) =>
    reply.code(201).send(await schedules.create(CreateScheduleRequestSchema.parse(req.body))),
  );

  // Hanya mengurai; tidak menyimpan sebelum pengguna mengonfirmasi lewat POST /schedules.
  app.post('/schedules/parse', guard, async (req) => {
    const { text, timezone } = ScheduleParseRequestSchema.parse(req.body);
    return ScheduleParseResponseSchema.parse(await schedules.parse(text, timezone));
  });

  app.patch('/schedules/:id', guard, (req) =>
    schedules.update(
      IdParamsSchema.parse(req.params).id,
      UpdateScheduleRequestSchema.parse(req.body),
    ),
  );

  app.delete('/schedules/:id', guard, async (req, reply) => {
    await schedules.remove(IdParamsSchema.parse(req.params).id);
    return reply.code(204).send();
  });

  app.post('/schedules/:id/run-now', guard, async (req, reply) =>
    reply.code(201).send(await schedules.runNow(IdParamsSchema.parse(req.params).id)),
  );

  app.get('/schedules/:id/runs', guard, (req) => {
    const q = PageQuerySchema.parse(req.query);
    return schedules.history(IdParamsSchema.parse(req.params).id, {
      before: q.before,
      limit: q.limit,
    });
  });

  done();
};
