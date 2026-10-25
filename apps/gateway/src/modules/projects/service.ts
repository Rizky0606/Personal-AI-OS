import type {
  CreateProjectRequestSchema,
  Project,
  UpdateProjectRequestSchema,
} from '@aios/contracts';
import { TERMINAL_RUN_STATUSES } from '@aios/contracts';
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
  /** Perangkat worker pemilik project; undefined bila project tidak ada. */
  workerOf(projectId: string): Promise<string | undefined>;
  /**
   * Menghapus project: kartu kanban dan aturan izin ikut terhapus, percakapan menjadi chat biasa. Ditolak bila
   * masih ada run yang berjalan di project ini. Folder di PC tidak disentuh (path tidak pernah ada di server).
   */
  remove(actorDeviceId: string, id: string): Promise<void>;
  /** Bagian pesan sistem berisi aturan project, atau string kosong bila tidak ada. */
  rulesSection(projectId: string): Promise<string>;
}

const notFound = () => new AppError(404, 'project_not_found', 'Project tidak ditemukan.');

export function toProjectDto(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    workerDeviceId: row.workerDeviceId,
    stack: row.stack,
    defaultBranch: row.defaultBranch,
    instructions: row.instructions,
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
          instructions: input.instructions,
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
          ...(patch.instructions !== undefined ? { instructions: patch.instructions } : {}),
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

    async remove(actorDeviceId, id) {
      await load(id);
      const active = await db.execute<{ n: number }>(sql`
        select count(*)::int as n from runs r
        left join conversations c on c.id = r.conversation_id
        left join tasks t on t.id = r.task_id
        where (c.project_id = ${id} or t.project_id = ${id})
          and r.status not in (${sql.join(
            TERMINAL_RUN_STATUSES.map((s) => sql`${s}`),
            sql`, `,
          )}, 'needs_review')`);
      if ((active.rows[0]?.n ?? 0) > 0) {
        throw new AppError(
          409,
          'project_busy',
          'Masih ada tugas yang berjalan di project ini. Hentikan atau tunggu selesai dulu.',
        );
      }
      await db.delete(projects).where(eq(projects.id, id));
      await writeAudit(db, { actorDeviceId, action: 'project.deleted', target: `project:${id}` });
    },

    async rulesSection(projectId) {
      const [row] = await db
        .select({ name: projects.name, instructions: projects.instructions })
        .from(projects)
        .where(eq(projects.id, projectId));
      if (!row?.instructions.trim()) return '';
      return `# Aturan project "${row.name}"\n\nDitulis pemilik untuk project ini. Patuhi selama tidak bertentangan dengan aturan keamanan di atas.\n\n${row.instructions.trim()}`;
    },

    async workerOf(projectId) {
      const [row] = await db
        .select({ workerDeviceId: projects.workerDeviceId })
        .from(projects)
        .where(eq(projects.id, projectId));
      return row?.workerDeviceId;
    },
  };
}
