import type { Surface } from '@aios/contracts';
import { pickAgent, selectSkills } from '@aios/roles';
import { desc, eq } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { routingDecisions } from '../../db/schema/index.js';
import type { RolesService } from '../roles/service.js';

export type DecisionRow = typeof routingDecisions.$inferSelect;

export interface RouteArgs {
  message: string;
  surface: Surface;
  projectId: string | null;
  /** Skill tambahan pilihan pemilik; menang atas kata kunci. */
  skills?: readonly string[];
  /** Skill yang dicabut pemilik; menang atas kata kunci dan pilihan tambahan. */
  skillsOff?: readonly string[];
}

export interface RouteResult {
  /** Agent tetap: `general` (server) atau `project` (worker). */
  agent: string;
  /** Skill spesialis yang dimuat (di luar skill inti dan skill milik agent). */
  skills: string[];
  /** Paket skill yang cocok dengan pesan. */
  packs: string[];
}

export interface RoutingService {
  /** Aturan tetap, tanpa model dan tanpa jaringan: agent dari ada tidaknya project, skill dari kata kunci. */
  route(args: RouteArgs): RouteResult;
  /** Menyimpan keputusan ke `routing_decisions`. */
  record(messageId: string, result: RouteResult): Promise<DecisionRow>;
  latestDecision(messageId: string): Promise<DecisionRow | undefined>;
}

/** Alasan yang disimpan dan dikirim ke klien (event `route.decided`). */
export function describeDecision(result: RouteResult): string {
  const agent = result.agent === 'project' ? 'Agent project' : 'Agent umum';
  return result.skills.length === 0
    ? `${agent}, tanpa skill tambahan.`
    : `${agent} dengan skill ${result.skills.join(', ')}.`;
}

export function createRoutingService(deps: { db: Database; roles: RolesService }): RoutingService {
  const { db, roles } = deps;

  return {
    route(args) {
      const agent = pickAgent({ surface: args.surface, hasProject: args.projectId !== null });
      const known = new Set(roles.registry().skills.keys());
      const { skills, packs } = selectSkills(args.message, {
        agent,
        known,
        extra: args.skills ?? [],
        exclude: args.skillsOff ?? [],
      });
      return { agent, skills, packs };
    },

    async record(messageId, result) {
      const [row] = await db
        .insert(routingDecisions)
        .values({
          messageId,
          role: result.agent,
          confidence: 1,
          reason: describeDecision(result),
          latencyMs: 0,
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
  };
}
