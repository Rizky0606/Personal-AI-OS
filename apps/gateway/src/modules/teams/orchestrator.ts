import type { AgentEvent, TeamPlan, TeamReviewRequest } from '@aios/contracts';
import { TeamPlanSchema, MAX_TEAM_PLAN_TASKS } from '@aios/contracts';
import { and, eq } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import type { Database } from '../../db/client.js';
import {
  messages,
  teamAssignments,
  teamMembers,
  teamReviews,
  teams,
  runs,
} from '../../db/schema/index.js';
import type { ChatService } from '../chat/service.js';
import type { RunsService } from '../runs/service.js';
import type { EventHub } from '../runs/hub.js';
import type { EventStore } from '../runs/store.js';
import type { TeamEventStore } from './store.js';

/*
 * Orkestrator Lead -> Worker (ORCA_DESIGN.md, Tahap 1). Lead berjalan lewat Hermes di VPS (keputusan
 * pemilik #1); Worker berjalan lewat omp di worker Windows lewat infrastruktur run coding yang SUDAH ADA
 * (worktree, cancel, timeout per run, review accept/reject dengan commit SHA) -- orkestrator ini HANYA
 * menyusun urutan panggilan ke service yang sudah ada (chat.sendMessage, runs.review, runs.cancel), tidak
 * menduplikasi mekanisme worktree/proses.
 *
 * Penyederhanaan yang disengaja (didokumentasikan di REPAIR_LOG/BACKLOG, bukan diam-diam):
 * - Lead TIDAK punya worktree sendiri: Lead (Hermes) tidak punya kemampuan filesystem ke worktree Worker.
 *   Tinjauan Lead memakai ringkasan teks + statistik diff (dari event `diff.updated` tersimpan), bukan
 *   checkout nyata. Ini keputusan terbuka #2 yang BELUM diimplementasikan secara literal; lihat BACKLOG.
 * - Slot global (keputusan #4) adalah semaphore in-process (bukan durable lintas proses gateway), konsisten
 *   dengan keputusan #7 (tidak resume otomatis setelah restart) dan karena gateway berjalan satu proses.
 */

const PLAN_BLOCK = /```orca-plan\s*\n([\s\S]*?)```/;
const REVIEW_BLOCK = /```orca-review\s*\n([\s\S]*?)```/;
const LEAD_REVIEW_DECISION = ['accept', 'revise', 'reject'] as const;
const TEAM_ADVANCE_QUEUE = 'team.advance';
const TERMINAL_CHAT = ['completed', 'failed', 'cancelled'] as const;
const TERMINAL_CODING = ['needs_review', 'completed', 'failed', 'cancelled'] as const;
// Keputusan review yang dipicu orkestrator (bukan manusia) ditulis ke audit log dengan actorDeviceId
// null -- kolomnya `uuid` dengan FK ke `devices.id`, jadi string penanda seperti 'orca-orchestrator'
// akan ditolak Postgres (bukan null-safe). null sudah didukung schema (onDelete: 'set null').

export interface TeamOrchestratorDeps {
  db: Database;
  chat: Pick<ChatService, 'createConversation' | 'sendMessage'>;
  runs: Pick<RunsService, 'get' | 'cancel' | 'review'>;
  hub: Pick<EventHub, 'publishLive'>;
  runEvents: Pick<EventStore, 'list'>;
  store: TeamEventStore;
  boss: PgBoss;
  now?: () => number;
  /** Interval polling status run (ms); tes memperkecil ini. */
  pollMs?: number;
  /** Jumlah Worker aktif maksimum LINTAS SEMUA TIM pada satu waktu (keputusan #4); default 1. */
  globalWorkerSlots?: number;
  log?: {
    warn: (obj: object, msg: string) => void;
    error: (obj: object, msg: string) => void;
  };
}

export interface TeamOrchestrator {
  /** Mendaftarkan antrean pg-boss dan memulihkan tim yang tertinggal (dipanggil sekali saat gateway start). */
  start(): Promise<void>;
  /** Menjadwalkan satu tim untuk mulai diproses (dipanggil setelah `teams.create`). */
  enqueue(teamId: string): Promise<void>;
  /** Menunggu semua pekerjaan tim aktif selesai (tes/shutdown). */
  idle(): Promise<void>;
  close(): Promise<void>;
}

/** Semaphore sederhana in-process untuk slot Worker global (keputusan #4). */
function createSemaphore(slots: number) {
  let available = Math.max(1, slots);
  const waiters: (() => void)[] = [];
  return {
    async acquire(): Promise<void> {
      if (available > 0) {
        available--;
        return;
      }
      await new Promise<void>((resolve) => waiters.push(resolve));
      available--;
    },
    release(): void {
      available++;
      const next = waiters.shift();
      if (next) next();
    },
  };
}

function parseBlock<T>(
  text: string,
  regex: RegExp,
  schema: { parse: (v: unknown) => T },
): T | null {
  const match = regex.exec(text);
  if (!match?.[1]) return null;
  try {
    return schema.parse(JSON.parse(match[1]));
  } catch {
    return null;
  }
}

async function assistantTextOf(db: Database, runId: string): Promise<string> {
  const [row] = await db
    .select({ parts: messages.parts })
    .from(messages)
    .where(and(eq(messages.runId, runId), eq(messages.author, 'assistant')));
  const parts = row?.parts ?? [];
  return parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('');
}

async function lastDiffStatOf(
  runEvents: Pick<EventStore, 'list'>,
  runId: string,
): Promise<{ path: string; additions: number; deletions: number }[]> {
  const events = await runEvents.list(runId, 0, 100_000);
  let last: { path: string; additions: number; deletions: number }[] = [];
  for (const { event } of events) {
    if (event.type === 'diff.updated') last = event.files;
  }
  return last;
}

export function createTeamOrchestrator(deps: TeamOrchestratorDeps): TeamOrchestrator {
  const {
    db,
    chat,
    runs: runsService,
    hub,
    runEvents,
    store,
    boss,
    now = Date.now,
    pollMs = 300,
    globalWorkerSlots = 1,
    log,
  } = deps;
  const semaphore = createSemaphore(globalWorkerSlots);
  const running = new Map<string, Promise<void>>();

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /** Menunggu run mencapai status terminal, menegakkan batas waktu, langkah, dan token (dibatalkan nyata). */
  async function waitForRun(
    runId: string,
    terminal: readonly string[],
    opts: { deadlineMs: number; stepsCap: number; tokensCap: number; cancelled: () => boolean },
  ): Promise<{ status: string }> {
    const startedAt = now();
    for (;;) {
      if (opts.cancelled()) {
        await runsService.cancel(runId).catch(() => undefined);
        return { status: 'cancelled' };
      }
      if (now() - startedAt > opts.deadlineMs) {
        await runsService.cancel(runId).catch(() => undefined);
        // Menunggu status final sungguhan (bukan mengasumsikan): cancel menunggu sampai beberapa detik.
        const run = await runsService.get(runId).catch(() => null);
        return { status: run?.status ?? 'cancelled' };
      }
      const events = await runEvents.list(runId, 0, 100_000);
      const steps = events.filter((e) => e.event.type === 'tool.started').length;
      const tokens = events.reduce((sum, e) => {
        const ev = e.event;
        if (ev.type === 'message.completed' && ev.usage) {
          return sum + ev.usage.inputTokens + ev.usage.outputTokens;
        }
        return sum;
      }, 0);
      if (steps > opts.stepsCap || tokens > opts.tokensCap) {
        await runsService.cancel(runId).catch(() => undefined);
        const run = await runsService.get(runId).catch(() => null);
        return { status: run?.status ?? 'cancelled' };
      }
      const run = await runsService.get(runId);
      if (terminal.includes(run.status)) return { status: run.status };
      await sleep(pollMs);
    }
  }

  async function sendToLead(conversationId: string, text: string) {
    return chat.sendMessage(conversationId, {
      parts: [{ type: 'text', text }],
      engine: 'hermes',
      skills: ['orca-lead'],
    });
  }

  async function publishAssignment(
    teamId: string,
    assignment: {
      id: string;
      title: string;
      status: string;
      attempt: number;
      workerMemberId: string | null;
    },
  ) {
    const event = {
      type: 'team.assignment.updated' as const,
      teamId,
      assignment: {
        id: assignment.id,
        title: assignment.title,
        status: assignment.status as never,
        attempt: assignment.attempt,
        workerMemberId: assignment.workerMemberId,
        updatedAt: new Date(now()).toISOString(),
      },
    };
    await store.append(teamId, event);
    hub.publishLive(`team:${teamId}`, event);
  }

  async function runOneAssignment(
    team: typeof teams.$inferSelect,
    leadConversationId: string,
    task: TeamPlan['tasks'][number],
    cancelled: () => boolean,
  ): Promise<{ ok: boolean }> {
    const limits = team.limits;
    const maxAttempts = (limits.maxReviewRounds ?? 2) + 1;
    const [assignment] = await db
      .insert(teamAssignments)
      .values({
        teamId: team.id,
        title: task.title,
        prompt: task.prompt,
        acceptanceCriteria: task.acceptanceCriteria,
        status: 'queued',
        attempt: 1,
        maxAttempts,
      })
      .returning();
    if (!assignment) throw new Error('assignment: insert tidak mengembalikan baris');
    const assignmentId = assignment.id;

    const conversation = await chat.createConversation({
      surface: 'windows',
      projectId: team.projectId,
      title: `Worker: ${task.title.slice(0, 48)}`,
    });

    let runId: string | undefined;
    let memberId: string | undefined;
    let attempt = 1;
    let prompt = task.prompt;

    for (;;) {
      if (cancelled()) {
        await db
          .update(teamAssignments)
          .set({ status: 'cancelled' })
          .where(eq(teamAssignments.id, assignmentId));
        return { ok: false };
      }
      const { run } = await chat.sendMessage(
        conversation.id,
        { parts: [{ type: 'text', text: prompt }] },
        {
          ...(runId ? { continueFromRunId: runId } : {}),
          ...(limits.memberTimeoutMinutes
            ? { timeoutMs: limits.memberTimeoutMinutes * 60_000 }
            : {}),
        },
      );
      runId = run.id;
      await db
        .update(teamAssignments)
        .set({ status: 'running', attempt })
        .where(eq(teamAssignments.id, assignmentId));
      if (memberId) {
        await db
          .update(teamMembers)
          .set({ runId, status: 'running' })
          .where(eq(teamMembers.id, memberId));
      } else {
        const [member] = await db
          .insert(teamMembers)
          .values({
            teamId: team.id,
            runId,
            role: 'worker',
            status: 'running',
            task: task.title,
            acceptanceCriteria: task.acceptanceCriteria,
          })
          .returning();
        memberId = member?.id;
        await db
          .update(teamAssignments)
          .set({ workerMemberId: memberId })
          .where(eq(teamAssignments.id, assignmentId));
      }
      await publishAssignment(team.id, {
        ...assignment,
        id: assignmentId,
        status: 'running',
        attempt,
      });

      await semaphore.acquire();
      let result: { status: string };
      try {
        result = await waitForRun(runId, TERMINAL_CODING, {
          deadlineMs: (limits.memberTimeoutMinutes ?? 30) * 60_000,
          stepsCap: limits.stepsPerMember ?? 100,
          tokensCap: limits.tokensPerMember ?? 40_000,
          cancelled,
        });
      } finally {
        semaphore.release();
      }

      if (result.status === 'failed' || result.status === 'cancelled') {
        await db
          .update(teamAssignments)
          .set({ status: result.status === 'cancelled' ? 'cancelled' : 'failed' })
          .where(eq(teamAssignments.id, assignmentId));
        if (memberId) {
          await db
            .update(teamMembers)
            .set({
              status: result.status === 'cancelled' ? 'cancelled' : 'failed',
              finishedAt: new Date(now()),
            })
            .where(eq(teamMembers.id, memberId));
        }
        await publishAssignment(team.id, {
          ...assignment,
          id: assignmentId,
          status: result.status,
          attempt,
        });
        return { ok: false };
      }

      // 'needs_review' (perubahan file) atau 'completed' (tidak ada perubahan): keduanya ditinjau Lead.
      const resultSummary = await assistantTextOf(db, runId);
      const diffStat = await lastDiffStatOf(runEvents, runId);
      const reviewRequest: TeamReviewRequest = {
        title: task.title,
        resultSummary: resultSummary || null,
        commitSha: null,
        diffStat,
        checks: [],
        attempt,
        maxAttempts,
      };
      await db
        .update(teamAssignments)
        .set({ status: 'needs_review', resultSummary: resultSummary || null })
        .where(eq(teamAssignments.id, assignmentId));
      await publishAssignment(team.id, {
        ...assignment,
        id: assignmentId,
        status: 'needs_review',
        attempt,
      });

      const leadText = [
        'Tinjau hasil Worker untuk tugas ini. Ringkasan jawaban Worker, statistik diff, dan info percobaan:',
        '```json',
        JSON.stringify(reviewRequest),
        '```',
      ].join('\n');
      const { run: leadRun } = await sendToLead(leadConversationId, leadText);
      const leadResult = await waitForRun(leadRun.id, TERMINAL_CHAT, {
        deadlineMs: 10 * 60_000,
        stepsCap: 1000,
        tokensCap: 1_000_000,
        cancelled,
      });
      const leadText2 =
        leadResult.status === 'completed' ? await assistantTextOf(db, leadRun.id) : '';
      const decision = parseBlock(leadText2, REVIEW_BLOCK, {
        parse: (v: unknown) => {
          const obj = v as { decision?: unknown; feedback?: unknown };
          if (!LEAD_REVIEW_DECISION.includes(obj.decision as never))
            throw new Error('decision tidak valid');
          return {
            decision: obj.decision as (typeof LEAD_REVIEW_DECISION)[number],
            feedback: typeof obj.feedback === 'string' ? obj.feedback : '',
          };
        },
      });

      if (!decision) {
        // Lead tidak memberi keputusan valid: diamankan sebagai reject (tidak pernah accept tanpa keputusan jelas).
        await runsService
          .review(null, runId, { decision: 'reject', comments: [], merge: false })
          .catch(() => undefined);
        await db
          .update(teamAssignments)
          .set({ status: 'failed', reviewStatus: 'reject' })
          .where(eq(teamAssignments.id, assignmentId));
        return { ok: false };
      }

      await db.insert(teamReviews).values({
        assignmentId,
        attempt,
        decision: decision.decision,
        feedback: decision.feedback,
        checks: [],
      });
      await store.append(team.id, {
        type: 'team.review.completed',
        teamId: team.id,
        memberId: memberId ?? assignmentId,
        decision: decision.decision,
        completedAt: new Date(now()).toISOString(),
      });

      if (decision.decision === 'accept') {
        const outcome = await runsService.review(null, runId, {
          decision: 'accept',
          comments: [],
          merge: false,
        });
        await db
          .update(teamAssignments)
          .set({ status: 'completed', reviewStatus: 'accept', resultRef: outcome.commit })
          .where(eq(teamAssignments.id, assignmentId));
        if (memberId) {
          await db
            .update(teamMembers)
            .set({ status: 'completed', finishedAt: new Date(now()), branch: outcome.branch })
            .where(eq(teamMembers.id, memberId));
        }
        await publishAssignment(team.id, {
          ...assignment,
          id: assignmentId,
          status: 'completed',
          attempt,
        });
        return { ok: true };
      }
      if (decision.decision === 'reject') {
        await runsService
          .review(null, runId, { decision: 'reject', comments: [], merge: false })
          .catch(() => undefined);
        await db
          .update(teamAssignments)
          .set({ status: 'failed', reviewStatus: 'reject' })
          .where(eq(teamAssignments.id, assignmentId));
        if (memberId) {
          await db
            .update(teamMembers)
            .set({ status: 'failed', finishedAt: new Date(now()) })
            .where(eq(teamMembers.id, memberId));
        }
        await publishAssignment(team.id, {
          ...assignment,
          id: assignmentId,
          status: 'failed',
          attempt,
        });
        return { ok: false };
      }
      // revise
      if (attempt >= maxAttempts) {
        await runsService
          .review(null, runId, { decision: 'reject', comments: [], merge: false })
          .catch(() => undefined);
        await db
          .update(teamAssignments)
          .set({ status: 'failed', reviewStatus: 'revise' })
          .where(eq(teamAssignments.id, assignmentId));
        if (memberId) {
          await db
            .update(teamMembers)
            .set({ status: 'needs_attention', finishedAt: new Date(now()) })
            .where(eq(teamMembers.id, memberId));
        }
        await publishAssignment(team.id, {
          ...assignment,
          id: assignmentId,
          status: 'failed',
          attempt,
        });
        return { ok: false };
      }
      attempt += 1;
      prompt = `Lead meminta revisi:\n\n${decision.feedback}`;
      // Lanjut ke iterasi berikut (continueFromRunId=runId lama, worktree yang sama dipertahankan).
    }
  }

  async function advance(teamId: string): Promise<void> {
    const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
    if (!team) return;
    const cancelled = () => team.cancelRequestedAt !== null;
    // Sudah dibatalkan sebelum sempat mulai.
    if (cancelled()) return;

    if (!team.parentRunId) return;
    const leadResult = await waitForRun(team.parentRunId, TERMINAL_CHAT, {
      deadlineMs: (team.limits.teamTimeoutMinutes ?? 120) * 60_000,
      stepsCap: 1000,
      tokensCap: 1_000_000,
      cancelled: () => false, // tim baru dibuat: pembatalan di titik ini ditangani endpoint cancel terpisah
    });
    if (leadResult.status !== 'completed') {
      await db
        .update(teams)
        .set({
          status: leadResult.status === 'cancelled' ? 'cancelled' : 'failed',
          finishedAt: new Date(now()),
        })
        .where(eq(teams.id, teamId));
      return;
    }
    const [leadRunRow] = await db.select().from(runs).where(eq(runs.id, team.parentRunId));
    const leadConversationId = leadRunRow?.conversationId;
    if (!leadConversationId) {
      await db
        .update(teams)
        .set({
          status: 'needs_attention',
          failureCode: 'lead_conversation_missing',
          finishedAt: new Date(now()),
        })
        .where(eq(teams.id, teamId));
      return;
    }
    const planText = await assistantTextOf(db, team.parentRunId);
    const plan = parseBlock(planText, PLAN_BLOCK, TeamPlanSchema);
    if (!plan || plan.tasks.length === 0 || plan.tasks.length > MAX_TEAM_PLAN_TASKS) {
      await db
        .update(teams)
        .set({
          status: 'needs_attention',
          failureCode: 'invalid_plan',
          finishedAt: new Date(now()),
        })
        .where(eq(teams.id, teamId));
      return;
    }
    await db.update(teams).set({ plan, status: 'running' }).where(eq(teams.id, teamId));

    let anyFailed = false;
    for (const task of plan.tasks) {
      if (cancelled()) break;
      const [fresh] = await db.select().from(teams).where(eq(teams.id, teamId));
      if (!fresh || fresh.cancelRequestedAt) break;
      const outcome = await runOneAssignment(
        fresh,
        leadConversationId,
        task,
        () => fresh.cancelRequestedAt !== null,
      ).catch((err: unknown) => {
        log?.error({ err, teamId }, 'assignment orca gagal tak terduga');
        return { ok: false };
      });
      if (!outcome.ok) anyFailed = true;
    }

    const [final] = await db.select().from(teams).where(eq(teams.id, teamId));
    if (final?.cancelRequestedAt) return; // sudah ditandai cancelled oleh endpoint cancel
    await db
      .update(teams)
      .set({ status: anyFailed ? 'needs_attention' : 'completed', finishedAt: new Date(now()) })
      .where(eq(teams.id, teamId));
  }

  return {
    async start() {
      await boss.createQueue(TEAM_ADVANCE_QUEUE, { retryLimit: 0, expireInSeconds: 6 * 3600 });
      // Pemulihan restart (keputusan #7): tim yang sedang berjalan saat gateway mati -> needs_attention,
      // TIDAK auto-resume/respawn Lead. Runner utama (chat) sudah menandai run 'running' yatim sebagai
      // 'failed' (gateway_restarted); di sini kita hanya menyamakan status team/member mengikutinya.
      const orphanTeams = await db.select().from(teams).where(eq(teams.status, 'running'));
      for (const row of orphanTeams) {
        if (running.has(row.id)) continue;
        await db
          .update(teams)
          .set({
            status: 'needs_attention',
            failureCode: 'gateway_restarted',
            finishedAt: new Date(now()),
          })
          .where(eq(teams.id, row.id));
        await db
          .update(teamMembers)
          .set({ status: 'needs_attention' })
          .where(eq(teamMembers.teamId, row.id));
      }
      await boss.work<{ teamId: string }>(
        TEAM_ADVANCE_QUEUE,
        { pollingIntervalSeconds: 1, batchSize: 1, localConcurrency: 1 },
        async (jobs) => {
          for (const job of jobs) {
            const p = advance(job.data.teamId).catch((err: unknown) =>
              log?.error({ err, teamId: job.data.teamId }, 'orkestrasi tim gagal'),
            );
            running.set(job.data.teamId, p);
            await p.finally(() => running.delete(job.data.teamId));
          }
        },
      );
    },
    async enqueue(teamId) {
      await boss.send(TEAM_ADVANCE_QUEUE, { teamId });
    },
    async idle() {
      await Promise.all([...running.values()]);
    },
    async close() {
      await this.idle();
    },
  };
}

// Dipakai tes untuk memvalidasi parser tanpa menjalankan orkestrator penuh.
export const __internal = { parseBlock, PLAN_BLOCK, REVIEW_BLOCK };
export type { AgentEvent };
