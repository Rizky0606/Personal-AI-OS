import type {
  CreateTaskRequestSchema,
  DiffStat,
  RunStatus,
  RunTaskRequestSchema,
  Task,
  TaskBreakdownRequestSchema,
  TaskBreakdownResponseSchema,
  TaskStatus,
  UpdateTaskRequestSchema,
} from '@aios/contracts';
import { and, asc, count, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import type { Database } from '../../db/client.js';
import { projects, runEvents, runs, tasks } from '../../db/schema/index.js';
import { AppError } from '../../errors.js';
import type { ChatService } from '../chat/service.js';
import type { RoutingService } from '../router/service.js';
import type { EventHub } from '../runs/hub.js';
import type { TaskBreakdown } from './breakdown.js';

type TaskRow = typeof tasks.$inferSelect;

export interface TasksService {
  list(projectId: string): Promise<Task[]>;
  create(input: z.infer<typeof CreateTaskRequestSchema>): Promise<Task>;
  update(id: string, patch: z.infer<typeof UpdateTaskRequestSchema>): Promise<Task>;
  /**
   * Mengerjakan kartu dengan AI. Bila batas run paralel project penuh, kartu masuk antrean
   * (status `running`, `runId` null) dan dimulai sendiri saat ada slot.
   */
  run(id: string, input: z.infer<typeof RunTaskRequestSchema>): Promise<Task>;
  breakdown(
    input: z.infer<typeof TaskBreakdownRequestSchema>,
  ): Promise<z.infer<typeof TaskBreakdownResponseSchema>>;
  /** Menyamakan kartu dengan run-nya; dipanggil pengamat run. Tidak melempar. */
  runChanged(runId: string): Promise<void>;
  /** Setelah restart: samakan kartu dengan run-nya lalu mulai antrean yang tertinggal. */
  start(): Promise<void>;
  /** Menunggu pekerjaan latar belakang selesai (shutdown dan tes). */
  idle(): Promise<void>;
}

export const DEFAULT_MAX_PARALLEL = 2;
const FALLBACK_CODING_ROLE = 'backend';
/** Kolom yang boleh dituju pengguna dengan seret; Running dan Review hanya diisi sistem. */
const USER_COLUMNS: TaskStatus[] = ['backlog', 'todo', 'done'];

const notFound = () => new AppError(404, 'task_not_found', 'Kartu tidak ditemukan.');
const projectMissing = () => new AppError(404, 'project_not_found', 'Project tidak ditemukan.');

export function toTaskDto(row: TaskRow): Task {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    body: row.body,
    status: row.status,
    position: row.position,
    agentRole: row.agentRole,
    runId: row.runId,
    branch: row.branch,
    diffStat: row.diffStat,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Status kartu menurut status run terbaru. `rejected` tanpa revisi berarti kartu kembali ke Todo. */
function columnFor(status: RunStatus): TaskStatus {
  switch (status) {
    case 'needs_review':
      return 'review';
    case 'accepted':
      return 'done';
    case 'completed':
    case 'rejected':
    case 'failed':
    case 'cancelled':
      return 'todo';
    default:
      return 'running';
  }
}

const promptOf = (task: Pick<TaskRow, 'title' | 'body'>) =>
  task.body.trim() ? `${task.title}\n\n${task.body.trim()}` : task.title;

export function createTasksService(deps: {
  db: Database;
  hub: Pick<EventHub, 'publishLive'>;
  chat: Pick<ChatService, 'createConversation' | 'sendMessage'>;
  routing: Pick<RoutingService, 'preview'>;
  roles: {
    get(roleId: string): { engine: string } | undefined;
    list(): { id: string; engine: string }[];
  };
  breakdown: TaskBreakdown;
  /** Batas run paralel per project. */
  maxParallel?: number;
  log?: { warn: (obj: object, msg: string) => void; error: (obj: object, msg: string) => void };
}): TasksService {
  const { db, hub, chat, routing, roles, breakdown, log } = deps;
  const maxParallel = Math.max(1, deps.maxParallel ?? DEFAULT_MAX_PARALLEL);

  /** Pekerjaan dengan kunci yang sama berjalan berurutan (per project untuk slot, per kartu untuk sinkronisasi). */
  const tails = new Map<string, Promise<unknown>>();
  const inflight = new Set<Promise<unknown>>();
  function serial<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = tails.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(work);
    tails.set(key, next);
    void next
      .then(
        () => undefined,
        () => undefined,
      )
      .then(() => {
        if (tails.get(key) === next) tails.delete(key);
      });
    return next;
  }

  const publish = (row: TaskRow) =>
    hub.publishLive('user', { type: 'task.updated', task: toTaskDto(row) });

  const notify = (title: string, body?: string) =>
    hub.publishLive('user', {
      type: 'notification',
      title,
      ...(body ? { body } : {}),
      level: 'error',
    });

  async function load(id: string): Promise<TaskRow> {
    const [row] = await db.select().from(tasks).where(eq(tasks.id, id));
    if (!row) throw notFound();
    return row;
  }

  async function assertProject(projectId: string) {
    const [row] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId));
    if (!row) throw projectMissing();
  }

  function assertCodingRole(role: string | null | undefined) {
    if (!role) return;
    const found = roles.get(role);
    if (!found) throw new AppError(400, 'unknown_role', `Role "${role}" tidak ada.`);
    if (found.engine !== 'omp') {
      throw new AppError(
        400,
        'role_not_coding',
        `Role "${role}" bukan role coding. Kartu hanya bisa dikerjakan role yang berjalan di worker.`,
      );
    }
  }

  /** Menaruh kartu di kolom `status` pada urutan `position` (default: paling bawah), lalu merapikan urutan kolom. */
  async function place(
    task: TaskRow,
    status: TaskStatus,
    position: number | undefined,
    set: Partial<typeof tasks.$inferInsert> = {},
  ): Promise<TaskRow> {
    return db.transaction(async (tx) => {
      const column = (s: TaskStatus) =>
        tx
          .select({ id: tasks.id, position: tasks.position })
          .from(tasks)
          .where(and(eq(tasks.projectId, task.projectId), eq(tasks.status, s)))
          .orderBy(asc(tasks.position), asc(tasks.id));
      const renumber = async (rows: { id: string; position: number }[]) => {
        for (const [i, r] of rows.entries()) {
          if (r.position !== i)
            await tx.update(tasks).set({ position: i }).where(eq(tasks.id, r.id));
        }
      };

      const target = (await column(status)).filter((r) => r.id !== task.id);
      const index = Math.min(position ?? target.length, target.length);
      await tx
        .update(tasks)
        .set({ ...set, status, position: index, updatedAt: new Date() })
        .where(eq(tasks.id, task.id));
      target.splice(index, 0, { id: task.id, position: index });
      await renumber(target);
      if (task.status !== status) {
        await renumber(await column(task.status));
      }
      const [row] = await tx.select().from(tasks).where(eq(tasks.id, task.id));
      return row!;
    });
  }

  async function activeCount(projectId: string): Promise<number> {
    const [row] = await db
      .select({ n: count() })
      .from(tasks)
      .where(
        and(eq(tasks.projectId, projectId), eq(tasks.status, 'running'), isNotNull(tasks.runId)),
      );
    return row?.n ?? 0;
  }

  /** Role kartu bila belum dipilih: router menebak, tetapi hasilnya harus role coding. */
  async function pickRole(task: TaskRow): Promise<string> {
    const fallback =
      roles.get(FALLBACK_CODING_ROLE)?.engine === 'omp'
        ? FALLBACK_CODING_ROLE
        : (roles.list().find((r) => r.engine === 'omp')?.id ?? FALLBACK_CODING_ROLE);
    try {
      const { decision } = await routing.preview({
        message: promptOf(task),
        surface: 'windows',
        projectId: task.projectId,
      });
      return roles.get(decision.role)?.engine === 'omp' ? decision.role : fallback;
    } catch (err) {
      log?.warn({ err, taskId: task.id }, 'router gagal memilih role kartu; memakai role bawaan');
      return fallback;
    }
  }

  /** Percakapan kartu: dipakai ulang bila kartu pernah dikerjakan, supaya riwayatnya satu. */
  async function conversationFor(task: TaskRow): Promise<string> {
    const [previous] = await db
      .select({ conversationId: runs.conversationId })
      .from(runs)
      .where(and(eq(runs.taskId, task.id), isNotNull(runs.conversationId)))
      .orderBy(desc(runs.id))
      .limit(1);
    if (previous?.conversationId) return previous.conversationId;
    const created = await chat.createConversation({
      surface: 'windows',
      projectId: task.projectId,
      title: task.title,
    });
    return created.id;
  }

  /** Memulai run coding untuk kartu. Dipanggil di dalam kunci project. */
  async function launch(task: TaskRow, model?: string): Promise<TaskRow> {
    const role = task.agentRole ?? (await pickRole(task));
    const conversationId = await conversationFor(task);
    const { run } = await chat.sendMessage(
      conversationId,
      {
        parts: [{ type: 'text', text: promptOf(task) }],
        role,
        ...(model ? { model } : {}),
      },
      { taskId: task.id },
    );
    const row = await place(task, 'running', undefined, {
      runId: run.id,
      agentRole: role,
      branch: null,
      diffStat: null,
    });
    publish(row);
    // Run bisa sudah bergerak sebelum runId tercatat; samakan sekali lagi.
    void runChanged(run.id);
    return row;
  }

  /** Mengisi slot kosong dengan kartu antrean (yang paling lama menunggu dulu). */
  function pump(projectId: string): Promise<void> {
    return serial(`project:${projectId}`, async () => {
      while ((await activeCount(projectId)) < maxParallel) {
        const [next] = await db
          .select()
          .from(tasks)
          .where(
            and(eq(tasks.projectId, projectId), eq(tasks.status, 'running'), isNull(tasks.runId)),
          )
          .orderBy(asc(tasks.position), asc(tasks.id))
          .limit(1);
        if (!next) return;
        try {
          await launch(next);
        } catch (err) {
          log?.warn({ err, taskId: next.id }, 'kartu antrean gagal dimulai');
          const back = await place(next, 'todo', undefined);
          publish(back);
          notify(
            `Kartu "${next.title}" gagal dimulai`,
            err instanceof Error ? err.message : undefined,
          );
        }
      }
    });
  }

  async function latestDiffStat(runId: string): Promise<DiffStat | null> {
    const [row] = await db
      .select({ payload: runEvents.payload })
      .from(runEvents)
      .where(and(eq(runEvents.runId, runId), eq(runEvents.type, 'diff.updated')))
      .orderBy(desc(runEvents.seq))
      .limit(1);
    if (row?.payload.type !== 'diff.updated') return null;
    const { files } = row.payload;
    return {
      files: files.length,
      additions: files.reduce((n, f) => n + f.additions, 0),
      deletions: files.reduce((n, f) => n + f.deletions, 0),
    };
  }

  async function syncFromRun(runId: string): Promise<void> {
    const [run] = await db.select().from(runs).where(eq(runs.id, runId));
    if (!run?.taskId) return;
    const [task] = await db.select().from(tasks).where(eq(tasks.id, run.taskId));
    if (!task) return;
    // Run lebih lama dari run kartu sekarang (mis. sebelum revisi): tidak boleh menimpa.
    if (task.runId && run.id < task.runId) return;
    if (run.status === 'rejected') {
      const [newer] = await db
        .select({ id: runs.id })
        .from(runs)
        .where(eq(runs.taskId, task.id))
        .orderBy(desc(runs.id))
        .limit(1);
      // Ditolak dengan komentar: revisi sudah berjalan dan menjadi run kartu.
      if (newer && newer.id > run.id) return;
    }

    const status = columnFor(run.status);
    const diffStat = (await latestDiffStat(run.id)) ?? task.diffStat;
    const agentRole = task.agentRole ?? run.agentRole;
    const set: Partial<typeof tasks.$inferInsert> = {
      runId: run.id,
      branch: run.branch ?? task.branch,
      diffStat,
      agentRole,
    };
    const unchanged =
      task.status === status &&
      task.runId === run.id &&
      task.branch === set.branch &&
      task.agentRole === agentRole &&
      JSON.stringify(task.diffStat) === JSON.stringify(diffStat);
    if (unchanged) return;

    const row =
      task.status === status
        ? (
            await db
              .update(tasks)
              .set({ ...set, updatedAt: new Date() })
              .where(eq(tasks.id, task.id))
              .returning()
          )[0]!
        : await place(task, status, undefined, set);
    publish(row);

    if (task.status === 'running' && status !== 'running') {
      if (run.status === 'failed') {
        notify(`Kartu "${task.title}" gagal dikerjakan`, run.error?.message);
      }
      void pump(task.projectId);
    }
  }

  function runChanged(runId: string): Promise<void> {
    const job = db
      .select({ taskId: runs.taskId })
      .from(runs)
      .where(eq(runs.id, runId))
      .then(([run]) =>
        run?.taskId ? serial(`task:${run.taskId}`, () => syncFromRun(runId)) : undefined,
      )
      .catch((err: unknown) => log?.error({ err, runId }, 'sinkronisasi kartu gagal'));
    inflight.add(job);
    void job.finally(() => inflight.delete(job));
    return job;
  }

  return {
    async list(projectId) {
      await assertProject(projectId);
      const rows = await db
        .select()
        .from(tasks)
        .where(eq(tasks.projectId, projectId))
        .orderBy(asc(tasks.position), asc(tasks.id));
      return rows.map(toTaskDto);
    },

    async create(input) {
      await assertProject(input.projectId);
      assertCodingRole(input.agentRole);
      if (!USER_COLUMNS.includes(input.status)) {
        throw new AppError(
          400,
          'status_managed',
          'Kartu baru hanya bisa dibuat di Backlog, Todo, atau Done. Running dan Review diisi saat kartu dikerjakan.',
        );
      }
      const [inserted] = await db
        .insert(tasks)
        .values({
          projectId: input.projectId,
          title: input.title.trim(),
          body: input.body,
          status: input.status,
          position: 0,
          agentRole: input.agentRole ?? null,
        })
        .returning();
      const row = await place(inserted!, input.status, undefined);
      publish(row);
      return toTaskDto(row);
    },

    async update(id, patch) {
      const task = await load(id);
      assertCodingRole(patch.agentRole);
      const active = task.status === 'running' && task.runId !== null;
      const moving = patch.status !== undefined && patch.status !== task.status;
      if ((moving || patch.position !== undefined) && active) {
        throw new AppError(
          409,
          'task_running',
          'Kartu ini sedang dikerjakan agent. Hentikan run-nya dulu sebelum memindahkan kartu.',
        );
      }
      if (moving && !USER_COLUMNS.includes(patch.status!)) {
        throw new AppError(
          400,
          'status_managed',
          'Running dan Review diisi sistem. Pakai "Kerjakan dengan AI" untuk memulai kartu.',
        );
      }

      const fields: Partial<typeof tasks.$inferInsert> = {
        ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        ...(patch.agentRole !== undefined ? { agentRole: patch.agentRole } : {}),
      };
      let row: TaskRow;
      if (moving || patch.position !== undefined) {
        row = await place(task, patch.status ?? task.status, patch.position, fields);
      } else if (Object.keys(fields).length > 0) {
        const [updated] = await db
          .update(tasks)
          .set({ ...fields, updatedAt: new Date() })
          .where(eq(tasks.id, id))
          .returning();
        row = updated!;
      } else {
        row = task;
      }
      publish(row);
      return toTaskDto(row);
    },

    async run(id, { model }) {
      const task = await load(id);
      if (task.status !== 'backlog' && task.status !== 'todo') {
        throw new AppError(
          409,
          'task_not_runnable',
          task.status === 'done'
            ? 'Kartu ini sudah selesai. Pindahkan ke Todo bila ingin mengerjakannya lagi.'
            : 'Kartu ini sedang dikerjakan atau menunggu tinjauan.',
        );
      }
      assertCodingRole(task.agentRole);
      const row = await serial(`project:${task.projectId}`, async () => {
        if ((await activeCount(task.projectId)) >= maxParallel) {
          const queued = await place(task, 'running', undefined, { runId: null, branch: null });
          publish(queued);
          return queued;
        }
        return launch(task, model);
      });
      return toTaskDto(row);
    },

    async breakdown({ projectId, idea }) {
      const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
      if (!project) throw projectMissing();
      const stack = [...project.stack.languages, ...project.stack.frameworks].join(', ');
      return breakdown.split(idea, { name: project.name, ...(stack ? { stack } : {}) });
    },

    runChanged,

    async start() {
      const live = await db
        .select({ projectId: tasks.projectId, runId: tasks.runId })
        .from(tasks)
        .where(eq(tasks.status, 'running'));
      for (const { runId } of live) if (runId) await runChanged(runId);
      for (const projectId of new Set(live.map((t) => t.projectId))) await pump(projectId);
    },

    async idle() {
      await Promise.all([...inflight, ...tails.values()]);
    },
  };
}
