import { AdapterError } from '@aios/adapters';
import {
  TERMINAL_RUN_STATUSES,
  type Approval,
  type QuestionAnswer,
  type QueueName,
  type ReviewComment,
  type ReviewRequestSchema,
  type ReviewResponseSchema,
  type Run,
  type SteerMode,
  type WorkspaceRunListSchema,
} from '@aios/contracts';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';
import type { Database } from '../../db/client.js';
import { approvals, conversations, projects, runs, tasks } from '../../db/schema/index.js';
import { AppError } from '../../errors.js';
import { writeAudit } from '../audit/repo.js';
import { toApprovalDto, toRunDto } from '../chat/dto.js';
import type { ChatService } from '../chat/service.js';
import type { EventHub } from './hub.js';
import type { RunObserver } from './observer.js';
import type { WorkerRelay } from '../worker/relay.js';
import type { Runner } from './runner.js';
import type { EventStore, StoredEvent } from './store.js';

export interface RunsService {
  get(id: string): Promise<Run>;
  /** Run terbaru menurut jenis (terbaru dulu) dengan judul dan project, untuk Ruang Kerja. */
  list(input: {
    kind: Run['kind'];
    limit: number;
  }): Promise<z.infer<typeof WorkspaceRunListSchema>>;
  events(
    id: string,
    afterSeq: number,
    limit: number,
  ): Promise<{ items: StoredEvent[]; lastSeq: number }>;
  cancel(id: string): Promise<Run>;
  /** Keputusan pengguna atas permintaan izin; diteruskan ke mesin (worker) yang menunggunya. */
  resolveApproval(
    actorDeviceId: string,
    runId: string,
    approvalId: string,
    input: { decision: 'allow' | 'deny'; remember: boolean },
  ): Promise<Approval>;
  /** Mengarahkan agent yang sedang berjalan dengan teks baru. */
  steer(runId: string, text: string, mode?: SteerMode): Promise<void>;
  /** Menarik arahan dari antrean agent yang sedang berjalan. */
  removeQueued(runId: string, queue: QueueName, text: string): Promise<void>;
  /** Jawaban pengguna atas pertanyaan agent; diteruskan ke mesin (worker) yang menunggunya. */
  answerQuestion(
    runId: string,
    questionId: string,
    result: { answers: QuestionAnswer[]; cancelled: boolean },
  ): Promise<void>;
  /**
   * Keputusan atas hasil run coding (status `needs_review`): terima (commit, opsional merge), tolak (buang),
   * atau tolak dengan komentar (agent memperbaiki di worktree yang sama lewat run baru).
   */
  review(
    actorDeviceId: string,
    runId: string,
    input: z.infer<typeof ReviewRequestSchema>,
  ): Promise<z.infer<typeof ReviewResponseSchema>>;
  /** Ada tidaknya run; dipakai WebSocket sebelum berlangganan. */
  exists(id: string): Promise<boolean>;
  projectId(id: string): Promise<string | null>;
}

const notFound = () => new AppError(404, 'run_not_found', 'Run tidak ditemukan.');
const notReviewable = () =>
  new AppError(409, 'run_not_reviewable', 'Run ini tidak sedang menunggu tinjauan hasil.');

function asAppError(error: unknown): unknown {
  if (error instanceof AdapterError) {
    return new AppError(error.retryable ? 503 : 409, error.code, error.message);
  }
  return error;
}

/** Komentar per baris dibundel jadi satu pesan: path, baris, dan isinya. */
export function bundleComments(comments: ReviewComment[]): string {
  const lines = comments.map(
    (c) => `- ${c.path}:${c.line} — ${c.body.trim().replace(/\s*\n\s*/g, ' ')}`,
  );
  return [
    'Saya meninjau perubahan Anda dan ada komentar pada baris tertentu.',
    'Perbaiki hanya bagian yang dikomentari dan jangan ubah bagian lain.',
    'Nomor baris merujuk ke versi berkas saat ini (setelah perubahan Anda).',
    '',
    ...lines,
  ].join('\n');
}

export function createRunsService(deps: {
  db: Database;
  store: EventStore;
  runner: Runner;
  hub: Pick<EventHub, 'publishLive'>;
  relay: Pick<WorkerRelay, 'review'>;
  chat: Pick<ChatService, 'sendMessage'>;
  observer?: RunObserver;
}): RunsService {
  const { db, store, runner, hub, relay, chat, observer } = deps;

  async function load(id: string) {
    const [row] = await db.select().from(runs).where(eq(runs.id, id));
    if (!row) throw notFound();
    return row;
  }

  /** Status akhir tinjauan; hanya dari needs_review (dua permintaan bersamaan tidak berlaku ganda). */
  async function settle(run: typeof runs.$inferSelect, status: 'accepted' | 'rejected') {
    const [updated] = await db
      .update(runs)
      .set({ status })
      .where(and(eq(runs.id, run.id), eq(runs.status, 'needs_review')))
      .returning();
    if (!updated) throw notReviewable();
    const stored = await store.append(run.id, { type: 'run.status', status });
    if (run.conversationId) hub.publishLive(`conversation:${run.conversationId}`, stored.event);
    observer?.notify(run.id);
    return updated;
  }

  return {
    async get(id) {
      return toRunDto(await load(id));
    },
    async projectId(id) {
      const [row] = await db
        .select({ projectId: conversations.projectId })
        .from(runs)
        .leftJoin(conversations, eq(conversations.id, runs.conversationId))
        .where(eq(runs.id, id));
      return row?.projectId ?? null;
    },

    async list({ kind, limit }) {
      const rows = await db
        .select({
          run: runs,
          taskTitle: tasks.title,
          taskProject: tasks.projectId,
          conversationTitle: conversations.title,
          conversationProject: conversations.projectId,
        })
        .from(runs)
        .leftJoin(tasks, eq(tasks.id, runs.taskId))
        .leftJoin(conversations, eq(conversations.id, runs.conversationId))
        .where(eq(runs.kind, kind))
        .orderBy(desc(runs.updatedAt))
        .limit(limit);
      const projectIds = [
        ...new Set(
          rows.flatMap((r) => {
            const id = r.taskProject ?? r.conversationProject;
            return id ? [id] : [];
          }),
        ),
      ];
      const names = new Map(
        projectIds.length
          ? (
              await db
                .select({ id: projects.id, name: projects.name })
                .from(projects)
                .where(inArray(projects.id, projectIds))
            ).map((p) => [p.id, p.name])
          : [],
      );
      return {
        items: rows.map((r) => {
          const projectId = r.taskProject ?? r.conversationProject ?? null;
          return {
            run: toRunDto(r.run),
            title: r.taskTitle ?? r.conversationTitle ?? '',
            projectId,
            projectName: projectId ? (names.get(projectId) ?? null) : null,
          };
        }),
      };
    },

    async events(id, afterSeq, limit) {
      await load(id);
      const items = await store.list(id, afterSeq, limit);
      return { items, lastSeq: items.at(-1)?.seq ?? afterSeq };
    },

    async cancel(id) {
      const run = await load(id);
      if (TERMINAL_RUN_STATUSES.includes(run.status)) {
        throw new AppError(409, 'run_not_active', `Run sudah ${run.status}.`);
      }
      if (!(await runner.cancel(id))) {
        // Tidak ada di memori tetapi belum final: sisa dari gateway yang mati (recoverOrphans menanganinya).
        throw new AppError(409, 'run_not_active', 'Run ini tidak sedang berjalan di gateway.');
      }
      return toRunDto(await load(id));
    },

    async resolveApproval(actorDeviceId, runId, approvalId, { decision, remember }) {
      const [row] = await db
        .select()
        .from(approvals)
        .where(and(eq(approvals.id, approvalId), eq(approvals.runId, runId)));
      if (!row) throw new AppError(404, 'approval_not_found', 'Permintaan izin tidak ditemukan.');
      if (row.status !== 'pending') {
        throw new AppError(
          409,
          'approval_already_resolved',
          'Permintaan izin ini sudah diputuskan.',
        );
      }
      try {
        const outcome = await runner.resolveApproval(runId, approvalId, decision, remember);
        if (outcome === 'inactive') {
          throw new AppError(409, 'run_not_active', 'Run ini tidak sedang berjalan di gateway.');
        }
      } catch (error) {
        if (error instanceof AdapterError) {
          throw new AppError(error.retryable ? 503 : 409, error.code, error.message);
        }
        throw error;
      }
      const [updated] = await db
        .update(approvals)
        .set({
          status: decision === 'allow' ? 'allowed' : 'denied',
          remember: decision === 'allow' && remember,
          decidedAt: new Date(),
        })
        .where(and(eq(approvals.id, approvalId), eq(approvals.status, 'pending')))
        .returning();
      await writeAudit(db, {
        actorDeviceId,
        action: 'approval.decided',
        target: `approval:${approvalId} ${decision}${remember ? ' remember' : ''}`,
      });
      return toApprovalDto(updated ?? row);
    },

    async steer(runId, text, mode) {
      await load(runId);
      try {
        if ((await runner.steer(runId, text, mode)) === 'inactive') {
          throw new AppError(409, 'run_not_active', 'Run ini tidak sedang berjalan di gateway.');
        }
      } catch (error) {
        if (error instanceof AdapterError) {
          throw new AppError(error.retryable ? 503 : 409, error.code, error.message);
        }
        throw error;
      }
    },

    async answerQuestion(runId, questionId, result) {
      await load(runId);
      try {
        if ((await runner.answerQuestion(runId, questionId, result)) === 'inactive') {
          throw new AppError(409, 'run_not_active', 'Run ini tidak sedang berjalan di gateway.');
        }
      } catch (error) {
        if (error instanceof AdapterError) {
          throw new AppError(error.retryable ? 503 : 409, error.code, error.message);
        }
        throw error;
      }
    },

    async removeQueued(runId, queue, text) {
      await load(runId);
      try {
        if ((await runner.removeQueued(runId, queue, text)) === 'inactive') {
          throw new AppError(409, 'run_not_active', 'Run ini tidak sedang berjalan di gateway.');
        }
      } catch (error) {
        if (error instanceof AdapterError) {
          throw new AppError(error.retryable ? 503 : 409, error.code, error.message);
        }
        throw error;
      }
    },

    async review(actorDeviceId, runId, input) {
      const run = await load(runId);
      if (run.status !== 'needs_review') throw notReviewable();
      const [conversation] = run.conversationId
        ? await db
            .select({ projectId: conversations.projectId })
            .from(conversations)
            .where(eq(conversations.id, run.conversationId))
        : [];
      if (!conversation?.projectId || !run.conversationId) throw notReviewable();
      const { projectId, conversationId } = {
        projectId: conversation.projectId,
        conversationId: run.conversationId,
      };

      if (input.decision === 'accept' && input.comments.length > 0) {
        throw new AppError(
          400,
          'invalid_request',
          'Komentar dikirim lewat "Kembalikan ke agent", bukan saat menerima.',
        );
      }

      // Tolak dengan komentar: agent memperbaiki di worktree yang sama, lewat run baru di percakapan ini.
      if (input.decision === 'reject' && input.comments.length > 0) {
        try {
          const { run: next } = await chat.sendMessage(
            conversationId,
            {
              parts: [{ type: 'text', text: bundleComments(input.comments) }],
              ...(run.agentRole ? { role: run.agentRole } : {}),
            },
            { continueFromRunId: run.id, ...(run.taskId ? { taskId: run.taskId } : {}) },
          );
          const settled = await settle(run, 'rejected');
          await writeAudit(db, {
            actorDeviceId,
            action: 'run.review',
            target: `run:${runId} revise ${input.comments.length} komentar`,
          });
          return {
            run: toRunDto(settled),
            branch: run.branch ?? '',
            commit: null,
            merged: false,
            mergeSkipped: null,
            revisionRunId: next.id,
          };
        } catch (error) {
          throw asAppError(error);
        }
      }

      let result;
      try {
        result = await relay.review(projectId, {
          type: 'review.apply',
          runId,
          decision: input.decision,
          comments: [],
          merge: input.merge,
          ...(input.commitMessage ? { commitMessage: input.commitMessage } : {}),
        });
      } catch (error) {
        throw asAppError(error);
      }
      if (!result.ok) {
        throw new AppError(
          409,
          'review_failed',
          result.error ?? 'Worker gagal menerapkan keputusan ini.',
        );
      }
      const settled = await settle(run, input.decision === 'accept' ? 'accepted' : 'rejected');
      await writeAudit(db, {
        actorDeviceId,
        action: 'run.review',
        target: `run:${runId} ${input.decision}${result.merged ? ' merged' : ''}`,
      });
      return {
        run: toRunDto(settled),
        branch: result.branch || (run.branch ?? ''),
        commit: result.commit,
        merged: result.merged,
        mergeSkipped: result.mergeSkipped,
        revisionRunId: null,
      };
    },

    async exists(id) {
      const [row] = await db.select({ id: runs.id }).from(runs).where(eq(runs.id, id));
      return !!row;
    },
  };
}
