import type { RoutePreviewRequestSchema, Surface } from '@aios/contracts';
import {
  MAX_CORRECTIONS,
  RouterRoleError,
  candidateRoles,
  createRouter,
  type Complete,
  type RouteResult,
  type RouterCorrection,
  type RouterHistoryItem,
  type RouterProject,
} from '@aios/roles';
import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import type { z } from 'zod';
import type { Database } from '../../db/client.js';
import { messages, projects, routingCorrections, routingDecisions } from '../../db/schema/index.js';
import { AppError } from '../../errors.js';
import type { RolesService } from '../roles/service.js';

export type DecisionRow = typeof routingDecisions.$inferSelect;
export type CorrectionRow = typeof routingCorrections.$inferSelect;

export interface RouteArgs {
  message: string;
  surface: Surface;
  projectId: string | null;
  /** Dipakai untuk mengambil riwayat singkat. */
  conversationId?: string;
  /** Hanya pesan sebelum ini yang masuk riwayat. */
  beforeMessageId?: string;
  previousRole?: string | null;
  /** Pilihan pemilik (chip role). */
  manualRole?: string;
}

export interface RoutingService {
  route(args: RouteArgs, signal?: AbortSignal): Promise<RouteResult>;
  /** Pratinjau tanpa menyimpan apa pun dan tanpa menjalankan agent. */
  preview(input: z.infer<typeof RoutePreviewRequestSchema>): Promise<RouteResult>;
  /** Melempar 400 bila role tidak ada atau tidak boleh dipakai di percakapan ini. */
  assertRoleAllowed(roleId: string, ctx: { surface: Surface; projectId: string | null }): void;
  /** Menyimpan keputusan ke `routing_decisions`. */
  record(messageId: string, result: RouteResult): Promise<DecisionRow>;
  latestDecision(messageId: string): Promise<DecisionRow | undefined>;
  addCorrection(input: {
    decisionId: string;
    fromRole: string;
    toRole: string;
    messageText: string;
  }): Promise<CorrectionRow>;
}

const EXCERPT_CHARS = 200;
const HISTORY_LIMIT = 5;

/** Alasan yang disimpan dan dikirim ke klien; sub-tugas dari needs_split ikut tertulis di sini. */
export function describeDecision(result: RouteResult): string {
  const { decision } = result;
  if (!decision.needsSplit) return decision.reason;
  const parts = decision.subtasks.map((s) => `${s.role}: ${s.title}`).join('; ');
  return `${decision.reason} Perlu dipecah menjadi ${decision.subtasks.length} sub-tugas (${parts}).`;
}

function toAppError(err: unknown): unknown {
  if (err instanceof RouterRoleError) {
    return new AppError(400, err.code, err.message);
  }
  return err;
}

export function createRoutingService(deps: {
  db: Database;
  roles: RolesService;
  complete: Complete;
  log?: { warn: (obj: object, msg: string) => void };
}): RoutingService {
  const { db, roles, complete } = deps;
  const router = createRouter({ registry: () => roles.registry(), complete });

  async function loadProject(projectId: string | null): Promise<RouterProject | undefined> {
    if (!projectId) return undefined;
    const [row] = await db.select().from(projects).where(eq(projects.id, projectId));
    if (!row) return undefined;
    const stack = [...row.stack.languages, ...row.stack.frameworks].join(', ');
    return { name: row.name, ...(stack ? { stack } : {}) };
  }

  async function loadHistory(
    conversationId: string,
    beforeMessageId: string | undefined,
  ): Promise<RouterHistoryItem[]> {
    const rows = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          inArray(messages.author, ['user', 'assistant']),
          beforeMessageId ? lt(messages.id, beforeMessageId) : undefined,
        ),
      )
      .orderBy(desc(messages.id))
      .limit(HISTORY_LIMIT * 2);
    return rows
      .flatMap((m): RouterHistoryItem[] => {
        const text = m.parts
          .map((p) => (p.type === 'text' ? p.text : ''))
          .join(' ')
          .trim();
        return text && (m.author === 'user' || m.author === 'assistant')
          ? [{ author: m.author, text }]
          : [];
      })
      .slice(0, HISTORY_LIMIT)
      .reverse();
  }

  async function loadCorrections(): Promise<RouterCorrection[]> {
    const rows = await db
      .select()
      .from(routingCorrections)
      .orderBy(desc(routingCorrections.id))
      .limit(MAX_CORRECTIONS);
    return rows.map((r) => ({ fromRole: r.fromRole, toRole: r.toRole, excerpt: r.messageExcerpt }));
  }

  async function route(args: RouteArgs, signal?: AbortSignal): Promise<RouteResult> {
    const [project, history, corrections] = await Promise.all([
      loadProject(args.projectId),
      args.conversationId
        ? loadHistory(args.conversationId, args.beforeMessageId)
        : Promise.resolve([]),
      loadCorrections(),
    ]);
    try {
      return await router.route(
        {
          message: args.message,
          surface: args.surface,
          ...(project ? { project } : {}),
          ...(args.previousRole ? { previousRole: args.previousRole } : {}),
          ...(args.manualRole ? { manualRole: args.manualRole } : {}),
          history,
          corrections,
        },
        signal,
      );
    } catch (err) {
      throw toAppError(err);
    }
  }

  return {
    route,

    async preview(input) {
      if (input.projectId) {
        const [project] = await db
          .select({ id: projects.id })
          .from(projects)
          .where(eq(projects.id, input.projectId));
        if (!project) throw new AppError(404, 'project_not_found', 'Project tidak ditemukan.');
      }
      return route({
        message: input.message,
        surface: input.surface,
        projectId: input.projectId ?? null,
        previousRole: input.previousRole ?? null,
      });
    },

    assertRoleAllowed(roleId, ctx) {
      const registry = roles.registry();
      if (!registry.roles.has(roleId)) {
        throw new AppError(400, 'unknown_role', `Role "${roleId}" tidak ada.`);
      }
      const allowed = candidateRoles(registry, {
        surface: ctx.surface,
        hasProject: ctx.projectId !== null,
      });
      if (!allowed.some((r) => r.id === roleId)) {
        throw new AppError(
          400,
          'role_not_allowed',
          `Role "${roleId}" butuh project; tanpa project hanya role grup Umum yang bisa dipilih.`,
        );
      }
    },

    async record(messageId, result) {
      const [row] = await db
        .insert(routingDecisions)
        .values({
          messageId,
          role: result.decision.role,
          confidence: result.decision.confidence,
          reason: describeDecision(result),
          latencyMs: result.latencyMs,
        })
        .returning();
      return row!;
    },

    async latestDecision(messageId) {
      const [row] = await db
        .select()
        .from(routingDecisions)
        .where(eq(routingDecisions.messageId, messageId))
        .orderBy(desc(routingDecisions.id))
        .limit(1);
      return row;
    },

    async addCorrection({ decisionId, fromRole, toRole, messageText }) {
      const [row] = await db
        .insert(routingCorrections)
        .values({
          decisionId,
          fromRole,
          toRole,
          messageExcerpt: messageText.replace(/\s+/g, ' ').trim().slice(0, EXCERPT_CHARS),
        })
        .returning();
      return row!;
    },
  };
}
