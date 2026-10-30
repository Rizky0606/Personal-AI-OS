import {
  TERMINAL_RUN_STATUSES,
  type TeamRequestSchema,
  type TeamDetailSchema,
  type TeamListSchema,
  type TeamSummarySchema,
} from '@aios/contracts';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';
import type { Database } from '../../db/client.js';
import { approvals, projects, runs, teamMembers, teams } from '../../db/schema/index.js';
import { AppError } from '../../errors.js';
import type { ChatService } from '../chat/service.js';
import type { RunsService } from '../runs/service.js';
import type { EventHub } from '../runs/hub.js';
import type { TeamEventStore } from './store.js';

export interface TeamsService {
  create(input: z.infer<typeof TeamRequestSchema>): Promise<z.infer<typeof TeamDetailSchema>>;
  list(): Promise<z.infer<typeof TeamListSchema>>;
  get(id: string): Promise<z.infer<typeof TeamDetailSchema>>;
  cancel(id: string): Promise<z.infer<typeof TeamDetailSchema>>;
  exists(id: string): Promise<boolean>;
}

const notFound = () => new AppError(404, 'team_not_found', 'Tim tidak ditemukan.');
const teamStatus = (status: string) => {
  if (status === 'needs_review' || status === 'accepted') return 'reviewing' as const;
  if (status === 'completed') return 'completed' as const;
  if (status === 'failed') return 'failed' as const;
  if (status === 'cancelled') return 'cancelled' as const;
  return 'running' as const;
};
const memberStatus = (status: string) => {
  if (status === 'needs_review' || status === 'accepted') return 'reviewing' as const;
  if (status === 'completed') return 'completed' as const;
  if (status === 'failed') return 'failed' as const;
  if (status === 'cancelled') return 'cancelled' as const;
  return 'running' as const;
};

export function createTeamsService(deps: {
  db: Database;
  chat: Pick<ChatService, 'createConversation' | 'sendMessage'>;
  runs: Pick<RunsService, 'get' | 'cancel'>;
  hub: Pick<EventHub, 'publishLive'>;
  store: TeamEventStore;
  now?: () => number;
}): TeamsService {
  const { db, chat, runs: runService, hub, store, now = Date.now } = deps;

  async function detail(id: string): Promise<z.infer<typeof TeamDetailSchema>> {
    const [row] = await db.select().from(teams).where(eq(teams.id, id));
    if (!row) throw notFound();
    const members = await db.select().from(teamMembers).where(eq(teamMembers.teamId, id));
    const runIds = members.map((member) => member.runId);
    const runRows = runIds.length ? await db.select().from(runs).where(inArray(runs.id, runIds)) : [];
    const byRun = new Map(runRows.map((run) => [run.id, run]));
    const leadRun = row.parentRunId ? byRun.get(row.parentRunId) : undefined;
    const status = row.cancelRequestedAt ? 'cancelled' : leadRun ? teamStatus(leadRun.status) : row.status;
    const approvalsRows = runIds.length
      ? await db.select().from(approvals).where(and(inArray(approvals.runId, runIds), eq(approvals.status, 'pending')))
      : [];
    const summaries = members.map((member) => {
      const run = byRun.get(member.runId);
      const state = run ? memberStatus(run.status) : member.status;
      return {
        id: member.id,
        role: member.role,
        status: state,
        task: member.task,
        branch: member.branch,
        runId: member.runId,
        updatedAt: (run?.updatedAt ?? member.updatedAt).toISOString(),
        exitReason: member.exitReason,
      };
    });
    return {
      id: row.id,
      projectId: row.projectId,
      status,
      memberCount: summaries.length,
      pendingApprovals: approvalsRows.length,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      parentRunId: row.parentRunId,
      prompt: row.prompt,
      limits: row.limits as z.infer<typeof TeamDetailSchema>['limits'],
      members: summaries,
      cancelRequestedAt: row.cancelRequestedAt?.toISOString() ?? null,
      failureCode: row.failureCode,
      finishedAt: row.finishedAt?.toISOString() ?? (leadRun && TERMINAL_RUN_STATUSES.includes(leadRun.status) ? leadRun.updatedAt.toISOString() : null),
    };
  }

  async function summary(id: string): Promise<z.infer<typeof TeamSummarySchema>> {
    const value = await detail(id);
    return {
      id: value.id,
      projectId: value.projectId,
      status: value.status,
      memberCount: value.memberCount,
      pendingApprovals: value.pendingApprovals,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
    };
  }

  return {
    async create(input) {
      const [project] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, input.projectId));
      if (!project) throw new AppError(404, 'project_not_found', 'Project tidak ditemukan.');
      const conversation = await chat.createConversation({
        surface: 'windows',
        projectId: input.projectId,
        title: `Lead: ${input.prompt.slice(0, 52)}`,
      });
      const { run } = await chat.sendMessage(conversation.id, {
        parts: [{ type: 'text', text: input.prompt }],
        ...(input.model ? { model: input.model } : {}),
      });
      const [team] = await db.insert(teams).values({
        projectId: input.projectId,
        parentRunId: run.id,
        prompt: input.prompt,
        limits: input.limits,
        status: 'running',
      }).returning();
      const [member] = await db.insert(teamMembers).values({
        teamId: team!.id,
        runId: run.id,
        role: 'lead',
        status: 'running',
        task: input.prompt,
      }).returning();
      const event = { type: 'team.created' as const, teamId: team!.id, status: 'queued' as const, createdAt: new Date(now()).toISOString() };
      await store.append(team!.id, event);
      hub.publishLive(`team:${team!.id}`, { type: 'team.member.updated', teamId: team!.id, member: {
        id: member!.id, role: 'lead', status: 'running', updatedAt: new Date(now()).toISOString(),
      } });
      return detail(team!.id);
    },
    async list() {
      const rows = await db.select({ id: teams.id }).from(teams).orderBy(desc(teams.createdAt));
      return { items: await Promise.all(rows.map((row) => summary(row.id))) };
    },
    get: detail,
    async cancel(id) {
      const value = await detail(id);
      if (value.status === 'completed' || value.status === 'failed' || value.status === 'cancelled') {
        throw new AppError(409, 'team_not_active', `Tim sudah ${value.status}.`);
      }
      await db.update(teams).set({ cancelRequestedAt: new Date(now()), status: 'cancelled', finishedAt: new Date(now()) }).where(eq(teams.id, id));
      if (value.parentRunId) {
        try {
          await runService.cancel(value.parentRunId);
        } catch (error) {
          if (!(error instanceof AppError && error.status === 409)) throw error;
        }
      }
      return detail(id);
    },
    async exists(id) {
      const [row] = await db.select({ id: teams.id }).from(teams).where(eq(teams.id, id));
      return !!row;
    },
  };
}
