import {
  canTransition,
  type CreateResearchRequestSchema,
  type ResearchDepth,
  type ResearchJob,
  type ResearchJobDetailSchema,
  type ResearchSource,
  type ResearchStage,
  type RunError,
  type RunStatus,
} from '@aios/contracts';
import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import type { z } from 'zod';
import type { Database } from '../../db/client.js';
import { researchJobs, researchSources, runs } from '../../db/schema/index.js';
import { AppError } from '../../errors.js';
import type { EventHub } from '../runs/hub.js';
import type { EventStore } from '../runs/store.js';
import { ResearchCancelled, ResearchError } from './errors.js';
import type { PageFetcher } from './fetcher.js';
import type { ResearchLlm } from './llm.js';
import { renderReportPdf } from './pdf.js';
import { DEPTHS, runPipeline, type DepthConfig, type PipelineHooks } from './pipeline.js';
import type { PageRenderer } from './render.js';
import { reportSlug } from './report.js';
import type { SearchClient } from './search.js';

export type ResearchJobRow = typeof researchJobs.$inferSelect;
export type ResearchJobDetail = z.infer<typeof ResearchJobDetailSchema>;

export interface ResearchExport {
  filename: string;
  contentType: string;
  body: string | Buffer;
}

export interface ResearchService {
  /** Menyalakan antrean pg-boss dan memulihkan job yang tertinggal. Dipanggil sekali saat gateway start. */
  start(): Promise<void>;
  create(input: z.infer<typeof CreateResearchRequestSchema>): Promise<ResearchJob>;
  list(q: {
    before?: string | undefined;
    limit: number;
  }): Promise<{ items: ResearchJob[]; nextBefore: string | null }>;
  get(id: string): Promise<ResearchJobDetail>;
  cancel(id: string): Promise<ResearchJob>;
  export(id: string, format: 'md' | 'pdf'): Promise<ResearchExport>;
  /** Menunggu job yang sedang berjalan selesai (tes). */
  idle(): Promise<void>;
  close(): Promise<void>;
}

export interface ResearchServiceDeps {
  db: Database;
  store: EventStore;
  hub: EventHub;
  /** pg-boss yang sudah `start()`; milik pemanggil (dihentikan di luar service ini). */
  boss: PgBoss;
  llmFor: (runId: string) => ResearchLlm;
  search: SearchClient;
  fetchPage: PageFetcher;
  renderer?: PageRenderer | undefined;
  models: { main: string; summary: string };
  roles: {
    bundle(roleId: string): { systemPrompt: string };
    get(roleId: string): { model: string } | undefined;
  };
  now?: () => number;
  /** Mengganti konfigurasi kedalaman (tes memperkecil jumlah sumber dan waktu). */
  depths?: Partial<Record<ResearchDepth, DepthConfig>>;
  log?: {
    warn: (obj: object, msg: string) => void;
    error: (obj: object, msg: string) => void;
  };
}

export const RESEARCH_QUEUE = 'research.run';
export const RESEARCH_ROLE = 'researcher';
const MAX_QUESTION_CHARS = 2000;
const CANCEL_WAIT_MS = 5000;
const TERMINAL = ['completed', 'failed', 'cancelled'] as const;

interface QueueData {
  researchId: string;
}

interface Active {
  abort: AbortController;
  cancelled: boolean;
  timedOut: boolean;
  /** Tahap terakhir yang dilaporkan; membedakan pesan batas waktu saat membaca atau menulis. */
  stage?: ResearchStage;
  done: Promise<void>;
}

const notFound = () => new AppError(404, 'research_not_found', 'Riset tidak ditemukan.');

export function toResearchJobDto(row: ResearchJobRow): ResearchJob {
  return {
    id: row.id,
    question: row.question,
    depth: row.depth,
    status: row.status,
    plan: row.plan,
    reportMd: row.reportMd,
    runId: row.runId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toResearchSourceDto(row: typeof researchSources.$inferSelect): ResearchSource {
  return {
    id: row.id,
    jobId: row.jobId,
    url: row.url,
    title: row.title,
    fetchedAt: row.fetchedAt?.toISOString() ?? null,
    used: row.used,
  };
}

export function createResearchService(deps: ResearchServiceDeps): ResearchService {
  const { db, store, hub, log } = deps;
  const now = deps.now ?? Date.now;
  const depthOf = (depth: ResearchDepth): DepthConfig => deps.depths?.[depth] ?? DEPTHS[depth];
  const active = new Map<string, Active>();
  const { boss } = deps;

  /* ---- run yang menampung event riset (dibaca lewat WebSocket run:<id> seperti run lain) ---- */

  async function advance(
    runId: string,
    from: RunStatus,
    to: RunStatus,
    extra: Partial<typeof runs.$inferInsert> = {},
  ) {
    if (!canTransition(from, to)) throw new Error(`transisi status tidak sah: ${from} -> ${to}`);
    await db
      .update(runs)
      .set({ status: to, ...extra })
      .where(eq(runs.id, runId));
    await store.append(runId, { type: 'run.status', status: to });
    return to;
  }

  async function failRun(runId: string, from: RunStatus, error: RunError) {
    if (!canTransition(from, 'failed')) return;
    await store.append(runId, { type: 'error', ...error });
    await advance(runId, from, 'failed', { error });
  }

  async function currentRunStatus(runId: string): Promise<RunStatus> {
    const [row] = await db.select({ status: runs.status }).from(runs).where(eq(runs.id, runId));
    return row?.status ?? 'queued';
  }

  async function load(id: string): Promise<ResearchJobRow> {
    const [row] = await db.select().from(researchJobs).where(eq(researchJobs.id, id));
    if (!row) throw notFound();
    return row;
  }

  /* ---- pelaksanaan job ---- */

  async function execute(jobId: string, ctl: Active): Promise<void> {
    // Hanya job yang masih `queued` yang diambil; yang dibatalkan saat antre dilewati.
    const [job] = await db
      .update(researchJobs)
      .set({ status: 'running' })
      .where(and(eq(researchJobs.id, jobId), eq(researchJobs.status, 'queued')))
      .returning();
    if (!job?.runId) return;
    const runId = job.runId;
    const config = depthOf(job.depth);
    const startedAt = now();
    const timer = setTimeout(
      () => {
        ctl.timedOut = true;
        ctl.abort.abort();
      },
      config.totalMs + (config.writeMs ?? 0),
    );
    timer.unref();

    let status: RunStatus = 'queued';
    let lastProgress = 0;
    try {
      status = await advance(runId, status, 'routing');
      await store.append(runId, {
        type: 'route.decided',
        role: RESEARCH_ROLE,
        confidence: 1,
        reason: 'Job riset mendalam.',
      });
      status = await advance(runId, status, 'preparing');
      status = await advance(runId, status, 'running');

      const hooks: PipelineHooks = {
        progress: async (stage: ResearchStage, progress: number, message?: string) => {
          ctl.stage = stage;
          lastProgress = Math.max(lastProgress, Math.min(1, progress));
          await store.append(runId, {
            type: 'research.progress',
            stage,
            progress: lastProgress,
            ...(message ? { message } : {}),
          });
        },
        setPlan: async (subQuestions) => {
          await db
            .update(researchJobs)
            .set({ plan: { subQuestions } })
            .where(eq(researchJobs.id, jobId));
        },
        sourceAccepted: async (source) => {
          const [row] = await db
            .insert(researchSources)
            .values({ jobId, url: source.url, title: source.title, fetchedAt: source.fetchedAt })
            .returning();
          await store.append(runId, {
            type: 'research.source',
            sourceId: row!.id,
            url: source.url,
            title: source.title || source.url,
          });
          return row!.id;
        },
      };

      const result = await runPipeline(
        { question: job.question, depth: job.depth, config, startedAt },
        {
          llm: deps.llmFor(runId),
          search: deps.search,
          fetchPage: deps.fetchPage,
          renderer: deps.renderer,
          models: deps.models,
          systemPrompt: deps.roles.bundle(RESEARCH_ROLE).systemPrompt,
          now,
          ...(log ? { log } : {}),
        },
        hooks,
        ctl.abort.signal,
      );

      // Baris DB final lebih dulu, lalu event penutup (urutan sama dengan run chat).
      if (result.citedSourceIds.length > 0) {
        await db
          .update(researchSources)
          .set({ used: true })
          .where(inArray(researchSources.id, result.citedSourceIds));
      }
      await db
        .update(researchJobs)
        .set({ status: 'completed', reportMd: result.reportMd })
        .where(eq(researchJobs.id, jobId));
      const { stats } = result;
      const summary =
        `Laporan riset selesai: ${stats.cited} sumber dikutip dari ${stats.sources} yang dibaca` +
        (stats.uncitedClaims > 0 ? `, ${stats.uncitedClaims} klaim belum punya rujukan` : '') +
        (stats.partial ? '; dibatasi waktu' : '') +
        '.';
      await store.append(runId, { type: 'run.completed', summary });
      await advance(runId, status, 'completed');
      hub.publishLive('user', { type: 'research.completed', researchId: jobId, runId });
    } catch (err) {
      const reason = ctl.cancelled ? 'cancelled' : ctl.timedOut ? 'timeout' : 'failed';
      if (reason === 'cancelled') {
        await db
          .update(researchJobs)
          .set({ status: 'cancelled' })
          .where(eq(researchJobs.id, jobId));
        const current = await currentRunStatus(runId);
        if (canTransition(current, 'cancelled')) await advance(runId, current, 'cancelled');
        return;
      }
      const error = toRunError(err, reason === 'timeout', ctl.stage);
      if (error.code === 'internal_error')
        log?.error({ err, researchId: jobId }, 'riset gagal tak terduga');
      await db.update(researchJobs).set({ status: 'failed' }).where(eq(researchJobs.id, jobId));
      try {
        await failRun(runId, await currentRunStatus(runId), error);
      } catch (inner) {
        log?.error({ err: inner, researchId: jobId }, 'gagal menandai run riset sebagai failed');
      }
    } finally {
      clearTimeout(timer);
    }
  }

  function toRunError(err: unknown, timedOut: boolean, stage?: ResearchStage): RunError {
    if (timedOut && stage === 'writing') {
      return {
        code: 'research_timeout',
        message:
          'Riset melewati batas waktu saat menyusun laporan (model lambat). Coba lagi, atau pilih model riset yang lebih cepat.',
        retryable: true,
      };
    }
    if (timedOut) {
      return {
        code: 'research_timeout',
        message: 'Riset melewati batas waktu sebelum ada sumber yang cukup untuk laporan.',
        retryable: true,
      };
    }
    if (err instanceof ResearchError) {
      return { code: err.code, message: err.message, retryable: err.retryable };
    }
    if (err instanceof ResearchCancelled) {
      return {
        code: 'gateway_stopping',
        message: 'Gateway dihentikan saat riset berjalan.',
        retryable: true,
      };
    }
    return {
      code: 'internal_error',
      message: 'Riset gagal karena kesalahan di gateway.',
      retryable: true,
    };
  }

  function process(jobId: string): Promise<void> {
    const ctl: Active = {
      abort: new AbortController(),
      cancelled: false,
      timedOut: false,
      done: Promise.resolve(),
    };
    active.set(jobId, ctl);
    ctl.done = execute(jobId, ctl)
      .catch((err: unknown) => log?.error({ err, researchId: jobId }, 'pelaksana riset error'))
      .finally(() => active.delete(jobId));
    return ctl.done;
  }

  /** Job `running` tanpa pelaksana (gateway mati di tengah jalan) ditandai gagal; pg-boss tidak mengulangnya. */
  async function recoverOrphans() {
    const rows = await db.select().from(researchJobs).where(eq(researchJobs.status, 'running'));
    for (const row of rows) {
      if (active.has(row.id)) continue;
      await db.update(researchJobs).set({ status: 'failed' }).where(eq(researchJobs.id, row.id));
      if (row.runId) {
        await failRun(row.runId, await currentRunStatus(row.runId), {
          code: 'gateway_restarted',
          message: 'Gateway dimulai ulang saat riset berjalan. Buat riset baru.',
          retryable: true,
        });
      }
    }
  }

  return {
    async start() {
      await boss.createQueue(RESEARCH_QUEUE, { retryLimit: 0, expireInSeconds: 3600 });
      await recoverOrphans();
      await boss.work<QueueData>(
        RESEARCH_QUEUE,
        { pollingIntervalSeconds: 1, batchSize: 1, localConcurrency: 1 },
        async (jobs) => {
          for (const job of jobs) await process(job.data.researchId);
        },
      );
    },

    async create(input) {
      const question = input.question.trim();
      if (!question) throw new AppError(400, 'empty_question', 'Pertanyaan tidak boleh kosong.');
      if (question.length > MAX_QUESTION_CHARS) {
        throw new AppError(
          400,
          'question_too_long',
          `Pertanyaan maksimal ${MAX_QUESTION_CHARS} karakter.`,
        );
      }

      const model = deps.roles.get(RESEARCH_ROLE)?.model ?? deps.models.main;
      const created = await db.transaction(async (tx) => {
        const [run] = await tx
          .insert(runs)
          .values({ kind: 'research', engine: 'research', agentRole: RESEARCH_ROLE, model })
          .returning();
        const [job] = await tx
          .insert(researchJobs)
          .values({ question, depth: input.depth, runId: run!.id })
          .returning();
        return { run: run!, job: job! };
      });
      await store.append(created.run.id, { type: 'run.status', status: 'queued' });
      try {
        await boss.send(RESEARCH_QUEUE, { researchId: created.job.id } satisfies QueueData, {
          expireInSeconds: Math.ceil(depthOf(input.depth).totalMs / 1000) + 300,
        });
      } catch (err) {
        log?.error({ err }, 'gagal memasukkan riset ke antrean');
        await db
          .update(researchJobs)
          .set({ status: 'failed' })
          .where(eq(researchJobs.id, created.job.id));
        await failRun(created.run.id, 'queued', {
          code: 'queue_unavailable',
          message: 'Antrean riset tidak bisa dipakai.',
          retryable: true,
        });
        throw new AppError(
          503,
          'queue_unavailable',
          'Antrean riset tidak bisa dipakai. Coba lagi sebentar.',
        );
      }
      return toResearchJobDto(created.job);
    },

    async list(q) {
      const rows = await db
        .select()
        .from(researchJobs)
        .where(q.before ? lt(researchJobs.id, q.before) : undefined)
        .orderBy(desc(researchJobs.id))
        .limit(q.limit + 1);
      const items = rows.slice(0, q.limit);
      return {
        items: items.map(toResearchJobDto),
        nextBefore: rows.length > q.limit ? (items.at(-1)?.id ?? null) : null,
      };
    },

    async get(id) {
      const job = await load(id);
      const sources = await db
        .select()
        .from(researchSources)
        .where(eq(researchSources.jobId, id))
        .orderBy(researchSources.id);
      return { ...toResearchJobDto(job), sources: sources.map(toResearchSourceDto) };
    },

    async cancel(id) {
      const job = await load(id);
      if ((TERMINAL as readonly string[]).includes(job.status)) {
        throw new AppError(409, 'research_not_active', `Riset sudah ${job.status}.`);
      }
      const ctl = active.get(id);
      if (ctl) {
        ctl.cancelled = true;
        ctl.abort.abort();
        await Promise.race([ctl.done, new Promise((r) => setTimeout(r, CANCEL_WAIT_MS))]);
      } else {
        // Masih antre: batalkan langsung; pelaksana akan melewati job yang bukan `queued`.
        const [row] = await db
          .update(researchJobs)
          .set({ status: 'cancelled' })
          .where(and(eq(researchJobs.id, id), eq(researchJobs.status, 'queued')))
          .returning();
        if (row?.runId) await advance(row.runId, 'queued', 'cancelled');
        else if (!row) {
          // Baru saja dimulai: pelaksana sudah terdaftar, ulangi lewat jalur aktif.
          const started = active.get(id);
          if (started) {
            started.cancelled = true;
            started.abort.abort();
            await Promise.race([started.done, new Promise((r) => setTimeout(r, CANCEL_WAIT_MS))]);
          }
        }
      }
      return toResearchJobDto(await load(id));
    },

    async export(id, format) {
      const job = await load(id);
      if (job.status !== 'completed' || !job.reportMd) {
        throw new AppError(409, 'research_not_completed', 'Laporan belum selesai dibuat.');
      }
      const filename = `riset-${reportSlug(job.question)}.${format}`;
      if (format === 'md') {
        return { filename, contentType: 'text/markdown; charset=utf-8', body: job.reportMd };
      }
      return {
        filename,
        contentType: 'application/pdf',
        body: await renderReportPdf(job.reportMd, { title: job.question }),
      };
    },

    async idle() {
      await Promise.all([...active.values()].map((a) => a.done));
    },

    async close() {
      for (const a of active.values()) a.abort.abort();
      await Promise.all([...active.values()].map((a) => a.done));
      await deps.renderer?.close();
    },
  };
}
