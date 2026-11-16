import {
  IdSchema,
  ProposedScheduleSchema,
  ProposedTaskSchema,
  type AgentProposal,
  type AgentProposalKind,
  type AgentProposalStatus,
  type ApproveAgentProposalRequestSchema,
  type ProposalAgent,
  type ProposedSchedule,
  type ProposedTask,
} from '@aios/contracts';
import { and, desc, eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { Database } from '../../db/client.js';
import { agentProposals } from '../../db/schema/index.js';
import { AppError } from '../../errors.js';
import { writeAudit } from '../audit/repo.js';
import type { EventHub } from '../runs/hub.js';
import { CronError, describeCron, normalizeCron } from '../schedules/cron.js';
import type { ScheduleService } from '../schedules/service.js';
import type { TasksService } from '../tasks/service.js';

/**
 * Usulan kartu dan jadwal dari agent (tool `task_propose`/`schedule_propose`, docs/DESIGN_MCP_TOOLS.md bagian 17).
 * Kartu atau jadwal hanya dibuat oleh `approve` atas keputusan pemilik; agent tidak pernah memanggil `create` service
 * kanban atau jadwal. Audit mencatat id dan jenis saja, tanpa isi.
 */
export interface AgentProposalService {
  create(input: NewAgentProposal): Promise<AgentProposal>;
  list(query: {
    status?: AgentProposalStatus | 'all' | undefined;
    kind?: AgentProposalKind | undefined;
    projectId?: string | undefined;
  }): Promise<AgentProposal[]>;
  get(id: string): Promise<AgentProposal>;
  approve(
    id: string,
    edits: z.infer<typeof ApproveAgentProposalRequestSchema>,
    actorDeviceId: string | null,
  ): Promise<AgentProposal>;
  reject(id: string, actorDeviceId: string | null): Promise<AgentProposal>;
}

export type NewAgentProposal = (
  | { kind: 'task'; task: ProposedTask; projectId: string }
  | { kind: 'schedule'; schedule: ProposedSchedule }
) & {
  agent: ProposalAgent;
  reason: string;
  afterWeb: boolean;
  conversationId: string | null;
  runId: string | null;
  /** Perangkat worker yang memanggil tool; null untuk Hermes. */
  actorDeviceId: string | null;
};

type Row = typeof agentProposals.$inferSelect;

const LIST_MAX = 200;
const NOTIFY_TEXT_MAX = 80;

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** Penjelasan jadwal; cron yang tidak bisa dijelaskan jatuh ke bentuk apa adanya. */
function describe(schedule: ProposedSchedule): string {
  try {
    return describeCron(schedule.cron, schedule.timezone);
  } catch {
    return `Cron "${schedule.cron}" (${schedule.timezone})`;
  }
}

function toDto(row: Row): AgentProposal {
  const base = {
    id: row.id,
    status: row.status,
    agent: row.agent,
    reason: row.reason,
    afterWeb: row.afterWeb,
    projectId: row.projectId,
    conversationId: row.conversationId,
    runId: row.runId,
    resultId: row.resultId,
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
  };
  if (row.kind === 'task') {
    return { ...base, kind: 'task', task: ProposedTaskSchema.parse(row.payload) };
  }
  const schedule = ProposedScheduleSchema.parse(row.payload);
  return { ...base, kind: 'schedule', schedule, description: describe(schedule) };
}

/** Cron dan zona waktu diperiksa dengan aturan yang sama dengan `POST /schedules`; galatnya 400. */
export function checkScheduleCron(cron: string, timezone: string): string {
  try {
    return normalizeCron(cron, timezone);
  } catch (err) {
    if (err instanceof CronError) throw new AppError(400, err.code, err.message);
    throw err;
  }
}

export function createAgentProposalService(deps: {
  db: Database;
  hub: Pick<EventHub, 'publishLive'>;
  tasks: Pick<TasksService, 'create'>;
  schedules: Pick<ScheduleService, 'create'>;
  now?: () => number;
}): AgentProposalService {
  const { db, hub, tasks, schedules } = deps;
  const now = deps.now ?? Date.now;

  const notFound = () => new AppError(404, 'proposal_not_found', 'Usulan tidak ditemukan.');
  const decided = () =>
    new AppError(409, 'proposal_decided', 'Usulan ini sudah diputuskan; tidak bisa diubah lagi.');

  async function load(id: string): Promise<Row> {
    if (!IdSchema.safeParse(id).success) throw notFound();
    const [row] = await db.select().from(agentProposals).where(eq(agentProposals.id, id));
    if (!row) throw notFound();
    return row;
  }

  const audit = (action: string, row: Row, actorDeviceId: string | null) =>
    writeAudit(db, { actorDeviceId, action, target: `agent_proposal:${row.id} kind:${row.kind}` });

  /** Payload setelah ubahan pemilik; ubahan untuk jenis lain ditolak. */
  function merged(
    row: Row,
    edits: z.infer<typeof ApproveAgentProposalRequestSchema>,
  ): ProposedTask | ProposedSchedule {
    if (row.kind === 'task') {
      if (edits.schedule) {
        throw new AppError(400, 'edit_kind_mismatch', 'Usulan ini kartu, bukan jadwal.');
      }
      return ProposedTaskSchema.parse({ ...ProposedTaskSchema.parse(row.payload), ...edits.task });
    }
    if (edits.task) {
      throw new AppError(400, 'edit_kind_mismatch', 'Usulan ini jadwal, bukan kartu.');
    }
    const { enabled: _enabled, ...scheduleEdits } = edits.schedule ?? {};
    const schedule = ProposedScheduleSchema.parse({
      ...ProposedScheduleSchema.parse(row.payload),
      ...scheduleEdits,
    });
    return { ...schedule, cron: checkScheduleCron(schedule.cron, schedule.timezone) };
  }

  return {
    async create(input) {
      const payload = input.kind === 'task' ? input.task : input.schedule;
      const [row] = await db
        .insert(agentProposals)
        .values({
          kind: input.kind,
          agent: input.agent,
          payload,
          reason: input.reason,
          afterWeb: input.afterWeb,
          projectId: input.kind === 'task' ? input.projectId : null,
          conversationId: input.conversationId,
          runId: input.runId,
          createdAt: new Date(now()),
        })
        .returning();
      await audit('agent_proposal.created', row!, input.actorDeviceId);
      hub.publishLive('user', {
        type: 'notification',
        level: 'info',
        topic: 'agent_proposal',
        title:
          input.kind === 'task'
            ? `Agent mengusulkan kartu: ${clip(input.task.title, NOTIFY_TEXT_MAX)}`
            : `Agent mengusulkan jadwal: ${clip(input.schedule.name, NOTIFY_TEXT_MAX)}`,
      });
      return toDto(row!);
    },

    async list({ status = 'pending', kind, projectId }) {
      const filters = [
        status === 'all' ? undefined : eq(agentProposals.status, status),
        kind ? eq(agentProposals.kind, kind) : undefined,
        projectId ? eq(agentProposals.projectId, projectId) : undefined,
      ].filter((f) => f !== undefined);
      const rows = await db
        .select()
        .from(agentProposals)
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(desc(agentProposals.createdAt), desc(agentProposals.id))
        .limit(LIST_MAX);
      return rows.map(toDto);
    },

    async get(id) {
      return toDto(await load(id));
    },

    async approve(id, edits, actorDeviceId) {
      const row = await load(id);
      if (row.status !== 'pending') throw decided();
      const payload = merged(row, edits);
      // Klaim atomik: dari dua persetujuan bersamaan hanya satu yang menemukan status pending.
      const [claimed] = await db
        .update(agentProposals)
        .set({ status: 'approved', decidedAt: new Date(now()) })
        .where(and(eq(agentProposals.id, id), eq(agentProposals.status, 'pending')))
        .returning({ id: agentProposals.id });
      if (!claimed) throw decided();

      let resultId: string;
      try {
        if (row.kind === 'task') {
          const task = payload as ProposedTask;
          if (!row.projectId) {
            throw new AppError(409, 'proposal_target_missing', 'Project usulan ini sudah dihapus.');
          }
          resultId = (
            await tasks.create({
              projectId: row.projectId,
              title: task.title,
              body: task.body,
              status: 'backlog',
            })
          ).id;
        } else {
          const schedule = payload as ProposedSchedule;
          resultId = (
            await schedules.create({
              ...schedule,
              agentRole: null,
              enabled: edits.schedule?.enabled ?? true,
              notify: 'always',
            })
          ).id;
        }
      } catch (err) {
        // Pembuatan gagal: usulan kembali menunggu supaya pemilik bisa memperbaiki atau menolaknya.
        await db
          .update(agentProposals)
          .set({ status: 'pending', decidedAt: null })
          .where(eq(agentProposals.id, id));
        throw err;
      }
      const [updated] = await db
        .update(agentProposals)
        .set({ payload, resultId })
        .where(eq(agentProposals.id, id))
        .returning();
      await audit('agent_proposal.approved', updated!, actorDeviceId);
      return toDto(updated!);
    },

    async reject(id, actorDeviceId) {
      await load(id);
      const [updated] = await db
        .update(agentProposals)
        .set({ status: 'rejected', decidedAt: new Date(now()) })
        .where(and(eq(agentProposals.id, id), eq(agentProposals.status, 'pending')))
        .returning();
      if (!updated) throw decided();
      await audit('agent_proposal.rejected', updated, actorDeviceId);
      return toDto(updated);
    },
  };
}
