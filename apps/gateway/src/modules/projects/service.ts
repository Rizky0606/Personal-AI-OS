import type {
  CreateProjectRequestSchema,
  Project,
  UpdateProjectRequestSchema,
} from '@aios/contracts';
import { desc, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { Database } from '../../db/client.js';
import { projects } from '../../db/schema/index.js';
import { AppError } from '../../errors.js';
import { writeAudit } from '../audit/repo.js';
import { findDevice } from '../auth/repo.js';

type ProjectRow = typeof projects.$inferSelect;

export interface ProjectsService {
  list(): Promise<Project[]>;
  create(
    actorDeviceId: string,
    input: z.infer<typeof CreateProjectRequestSchema>,
  ): Promise<Project>;
  update(
    actorDeviceId: string,
    id: string,
    patch: z.infer<typeof UpdateProjectRequestSchema>,
  ): Promise<Project>;
  /** Project milik worker ini? Dipakai hub worker sebelum menerima event run. */
  ownedBy(projectId: string, workerDeviceId: string): Promise<boolean>;
  /** Run ini milik project (lewat kartu atau percakapan) yang terdaftar atas worker tersebut? */
  ownsRun(workerDeviceId: string, runId: string): Promise<boolean>;
}

const notFound = () => new AppError(404, 'project_not_found', 'Project tidak ditemukan.');

export function toProjectDto(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    workerDeviceId: row.workerDeviceId,
    stack: row.stack,
    defaultBranch: row.defaultBranch,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Project terdaftar per worker. Hanya metadata: path folder tidak pernah sampai ke server
 * (ARCHITECTURE.md, "Kepemilikan data"); path tetap di worker.
 */
export function createProjectsService(deps: { db: Database }): ProjectsService {
  const { db } = deps;

  async function load(id: string): Promise<ProjectRow> {
    const [row] = await db.select().from(projects).where(eq(projects.id, id));
    if (!row) throw notFound();
    return row;
  }

  return {
    async list() {
      return (await db.select().from(projects).orderBy(desc(projects.id))).map(toProjectDto);
    },

    async create(actorDeviceId, input) {
      // Hanya perangkat worker yang masih aktif yang boleh memegang project.
      const worker = await findDevice(db, input.workerDeviceId);
      if (!worker || worker.revokedAt || worker.kind !== 'worker') {
        throw new AppError(
          400,
          'invalid_worker',
          'workerDeviceId harus perangkat worker yang aktif. Daftarkan worker lebih dulu.',
        );
      }
      const [row] = await db
        .insert(projects)
        .values({
          name: input.name,
          workerDeviceId: input.workerDeviceId,
          stack: input.stack,
          defaultBranch: input.defaultBranch,
        })
        .returning();
      if (!row) throw new Error('insert project gagal');
      await writeAudit(db, {
        actorDeviceId,
        action: 'project.created',
        target: `project:${row.id}`,
      });
      return toProjectDto(row);
    },

    async update(actorDeviceId, id, patch) {
      await load(id);
      const [row] = await db
        .update(projects)
        .set({
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.stack !== undefined ? { stack: patch.stack } : {}),
          ...(patch.defaultBranch !== undefined ? { defaultBranch: patch.defaultBranch } : {}),
          updatedAt: new Date(),
        })
        .where(eq(projects.id, id))
        .returning();
      if (!row) throw notFound();
      await writeAudit(db, {
        actorDeviceId,
        action: 'project.updated',
        target: `project:${id}`,
      });
      return toProjectDto(row);
    },

    async ownedBy(projectId, workerDeviceId) {
      const [row] = await db
        .select({ workerDeviceId: projects.workerDeviceId })
        .from(projects)
        .where(eq(projects.id, projectId));
      return row?.workerDeviceId === workerDeviceId;
    },

    async ownsRun(workerDeviceId, runId) {
      const result = await db.execute(sql`
        select 1
        from runs r
        left join tasks t on t.id = r.task_id
        left join conversations c on c.id = r.conversation_id
        join projects p on p.id = coalesce(t.project_id, c.project_id)
        where r.id = ${runId}::uuid and p.worker_device_id = ${workerDeviceId}::uuid
        limit 1`);
      return result.rows.length > 0;
    },
  };
}
