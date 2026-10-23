import {
  CreateTaskRequestSchema,
  IdParamsSchema,
  RunTaskRequestSchema,
  TaskBreakdownRequestSchema,
  UpdateTaskRequestSchema,
} from '@aios/contracts';
import type { FastifyPluginCallback } from 'fastify';
import { requireScope } from '../auth/guard.js';
import type { TasksService } from './service.js';

/** Kartu kanban dikelola dari klien aplikasi: scope `app`. */
export const taskRoutes: FastifyPluginCallback<{ tasks: TasksService }> = (
  app,
  { tasks },
  done,
) => {
  const guard = { onRequest: requireScope('app') };

  app.get('/projects/:id/tasks', guard, async (req) => ({
    items: await tasks.list(IdParamsSchema.parse(req.params).id),
  }));

  app.post('/tasks', guard, async (req, reply) =>
    reply.code(201).send(await tasks.create(CreateTaskRequestSchema.parse(req.body))),
  );

  // Hanya mengusulkan; kartu baru ada setelah pengguna memilih lalu menyimpannya lewat POST /tasks.
  app.post('/tasks/breakdown', guard, (req) =>
    tasks.breakdown(TaskBreakdownRequestSchema.parse(req.body)),
  );

  app.patch('/tasks/:id', guard, (req) =>
    tasks.update(IdParamsSchema.parse(req.params).id, UpdateTaskRequestSchema.parse(req.body)),
  );

  app.post('/tasks/:id/run', guard, (req) =>
    tasks.run(IdParamsSchema.parse(req.params).id, RunTaskRequestSchema.parse(req.body ?? {})),
  );

  done();
};
