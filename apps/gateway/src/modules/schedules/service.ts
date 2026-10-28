import {
  TERMINAL_RUN_STATUSES,
  type CreateScheduleRequestSchema,
  type Run,
  type Schedule,
  type ScheduleRun,
  type UpdateScheduleRequestSchema,
} from '@aios/contracts';
import { and, desc, eq, lt } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import type { z } from 'zod';
import type { Database } from '../../db/client.js';
import { conversations, messages, runs, scheduleRuns, schedules } from '../../db/schema/index.js';
import { AppError } from '../../errors.js';
import type { ChatService } from '../chat/service.js';
import { toRunDto } from '../chat/dto.js';
import type { ResearchService } from '../research/service.js';
import type { EventHub } from '../runs/hub.js';
import { CronError, nextRuns, normalizeCron, occurrencesBetween } from './cron.js';
import { briefingContext, changeContext, previousResult, readChange } from './briefing.js';
import { SCHEDULABLE_ENGINES, type ParsedSchedule, type ScheduleParser } from './parser.js';

export type ScheduleRow = typeof schedules.$inferSelect;

export interface ScheduleService {
  /** Mendaftarkan antrean dan cron ke pg-boss, menutup run yang tertinggal, dan mencatat jadwal yang terlewat. */
  start(): Promise<void>;
  parse(text: string, timezone: string): Promise<ParsedSchedule>;
  list(): Promise<Schedule[]>;
  create(input: z.infer<typeof CreateScheduleRequestSchema>): Promise<Schedule>;
  update(id: string, patch: z.infer<typeof UpdateScheduleRequestSchema>): Promise<Schedule>;
  remove(id: string): Promise<void>;
  /** Memulai satu run sekarang dan mengembalikannya segera; hasilnya diselesaikan di latar belakang. */
  runNow(id: string): Promise<Run>;
  history(
    id: string,
    q: { before?: string | undefined; limit: number },
  ): Promise<{ items: ScheduleRun[]; nextBefore: string | null }>;
  /**
   * Mencatat kemunculan jadwal yang terlewat (server mati) sebagai `schedule_runs` berstatus `missed`,
   * lalu memajukan `next_run_at`. Mengembalikan jumlah baris yang dicatat.
   */
  recordMissed(): Promise<number>;
  /** Menunggu run yang sedang diselesaikan di latar belakang (tes, shutdown). */
  idle(): Promise<void>;
  close(): Promise<void>;
}

export interface ScheduleServiceDeps {
  db: Database;
  boss: PgBoss;
  hub: EventHub;
  chat: Pick<ChatService, 'sendMessage'>;
  research: Pick<ResearchService, 'create' | 'get'>;
  parser: ScheduleParser;
  roles: { get(id: string): { engine: string } | undefined };
  now?: () => number;
  log?: {
    info: (obj: object, msg: string) => void;
    warn: (obj: object, msg: string) => void;
    error: (obj: object, msg: string) => void;
  };
  /** Selang memeriksa status run yang ditunggu (ms). */
  pollMs?: number;
  /** Selang pencatatan jadwal terlewat berkala (ms); 0 mematikan. */
  missedCheckMs?: number;
}

export const SCHEDULE_QUEUE = 'schedule.run';
/** Kemunculan yang lebih tua dari ini dianggap terlewat; yang lebih muda masih mungkin dijalankan cron pg-boss. */
const MISSED_GRACE_MS = 120_000;
const MAX_MISSED_ROWS = 20;
const CHAT_WAIT_MS = 20 * 60_000;
const RESEARCH_WAIT_MS = 35 * 60_000;
const SCHEDULE_SURFACE = 'android';

interface QueueData {
  scheduleId: string;
}

const notFound = () => new AppError(404, 'schedule_not_found', 'Jadwal tidak ditemukan.');

export function toScheduleDto(row: ScheduleRow): Schedule {
  return {
    id: row.id,
    name: row.name,
    cron: row.cron,
    timezone: row.timezone,
    prompt: row.prompt,
    target: row.target,
    agentRole: row.agentRole,
    enabled: row.enabled,
    notify: row.notify,
    nextRunAt: row.nextRunAt?.toISOString() ?? null,
    conversationId: row.conversationId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toRunHistoryDto(row: typeof scheduleRuns.$inferSelect): ScheduleRun {
  return {
    id: row.id,
    scheduleId: row.scheduleId,
    runId: row.runId,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    changed: row.changed,
  };
}

const isUniqueViolation = (err: unknown): boolean => {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === '23505' || e?.cause?.code === '23505';
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createScheduleService(deps: ScheduleServiceDeps): ScheduleService {
  const { db, boss, hub, log } = deps;
  const now = deps.now ?? Date.now;
  const pollMs = deps.pollMs ?? 1000;
  const inflight = new Set<Promise<unknown>>();
  const stopping = new AbortController();
  let missedTimer: NodeJS.Timeout | undefined;

  /* ---- validasi dan sinkronisasi ke pg-boss ---- */

  /** Memeriksa cron, zona waktu, dan role; melempar AppError 400. */
  function validate(input: {
    cron: string;
    timezone: string;
    target: string;
    agentRole: string | null;
    notify?: string;
  }) {
    let cron: string;
    try {
      cron = normalizeCron(input.cron, input.timezone);
    } catch (err) {
      if (err instanceof CronError) throw new AppError(400, err.code, err.message);
      throw err;
    }
    if (input.target === 'role' && !input.agentRole) {
      throw new AppError(400, 'agent_role_required', 'Target "role" wajib mengisi agentRole.');
    }
    const researchEngine =
      input.target === 'research' ||
      (input.target === 'role' && deps.roles.get(input.agentRole ?? '')?.engine === 'research');
    if (input.notify === 'on_change' && researchEngine) {
      throw new AppError(
        400,
        'notify_unsupported',
        'Notifikasi "hanya bila berubah" belum bisa dipakai untuk jadwal riset.',
      );
    }
    if (input.agentRole) {
      const role = deps.roles.get(input.agentRole);
      if (!role) throw new AppError(400, 'unknown_role', `Role "${input.agentRole}" tidak ada.`);
      if (!SCHEDULABLE_ENGINES.has(role.engine)) {
        throw new AppError(
          400,
          'role_not_schedulable',
          `Role "${input.agentRole}" berjalan di worker Windows dan belum bisa dijadwalkan.`,
        );
      }
    }
    return cron;
  }

  const nextAfter = (row: Pick<ScheduleRow, 'cron' | 'timezone'>, from = new Date(now())) =>
    nextRuns(row.cron, row.timezone, from, 1)[0] ?? null;

  /** Cron di pg-boss: zona waktu dan singleton per jadwal; kemunculan yang terlewat dicatat sendiri, bukan dijalankan terlambat. */
  async function syncQueue(row: ScheduleRow) {
    if (!row.enabled) {
      await boss.unschedule(SCHEDULE_QUEUE, row.id);
      return;
    }
    await boss.schedule(SCHEDULE_QUEUE, row.cron, { scheduleId: row.id } satisfies QueueData, {
      tz: row.timezone,
      key: row.id,
      singletonKey: row.id,
      missed: 'skip',
    });
  }

  async function load(id: string): Promise<ScheduleRow> {
    const [row] = await db.select().from(schedules).where(eq(schedules.id, id));
    if (!row) throw notFound();
    return row;
  }

  /* ---- hasil run ---- */

  async function addMessages(
    conversationId: string,
    runId: string | null,
    prompt: string,
    outcome: { kind: 'answer'; text: string; role: string } | { kind: 'failure'; text: string },
    includePrompt: boolean,
  ) {
    await db.transaction(async (tx) => {
      if (includePrompt) {
        await tx.insert(messages).values({
          conversationId,
          author: 'user',
          parts: [{ type: 'text', text: prompt }],
          runId,
        });
      }
      await tx.insert(messages).values(
        outcome.kind === 'answer'
          ? {
              conversationId,
              author: 'assistant' as const,
              parts: [{ type: 'text' as const, text: outcome.text }],
              agentRole: outcome.role,
              runId,
            }
          : {
              conversationId,
              author: 'system' as const,
              parts: [{ type: 'text' as const, text: `Jadwal gagal: ${outcome.text}` }],
              runId,
            },
      );
      await tx
        .update(conversations)
        .set({ updatedAt: new Date(now()) })
        .where(eq(conversations.id, conversationId));
    });
  }

  async function conversationOf(row: ScheduleRow): Promise<string> {
    if (row.conversationId) return row.conversationId;
    const [created] = await db
      .insert(conversations)
      .values({ title: row.name, surface: SCHEDULE_SURFACE })
      .returning({ id: conversations.id });
    await db.update(schedules).set({ conversationId: created!.id }).where(eq(schedules.id, row.id));
    return created!.id;
  }

  async function waitFor<T>(
    read: () => Promise<T>,
    done: (value: T) => boolean,
    timeoutMs: number,
  ): Promise<T | undefined> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = await read();
      if (done(value)) return value;
      if (Date.now() > deadline || stopping.signal.aborted) return undefined;
      await sleep(pollMs);
    }
  }

  /** Menutup `schedule_runs` dan mengumumkan hasilnya (event `schedule.result` memicu push). */
  async function finalize(
    row: ScheduleRow,
    scheduleRunId: string,
    runId: string | null,
    status: 'succeeded' | 'failed',
    changed: boolean | null = null,
  ) {
    await db
      .update(scheduleRuns)
      .set({ status, finishedAt: new Date(now()), changed })
      .where(eq(scheduleRuns.id, scheduleRunId));
    hub.publishLive('user', {
      type: 'schedule.result',
      scheduleId: row.id,
      scheduleRunId,
      runId,
      status,
      ...(changed !== null ? { changed } : {}),
    });
  }

  /**
   * Konteks tersembunyi untuk run chat: data briefing (target briefing) dan hasil run sebelumnya (notify
   * on_change). `compare` true bila ada hasil sebelumnya yang dibandingkan.
   */
  async function contextFor(
    row: ScheduleRow,
    conversationId: string,
  ): Promise<{ context: string; compare: boolean }> {
    const parts: string[] = [];
    if (row.target === 'briefing') {
      parts.push(
        await briefingContext(db, {
          now: new Date(now()),
          timezone: row.timezone,
          scheduleId: row.id,
        }),
      );
    }
    let compare = false;
    if (row.notify === 'on_change') {
      const previous = await previousResult(db, conversationId);
      if (previous) {
        parts.push(changeContext(previous, row.timezone));
        compare = true;
      }
    }
    return { context: parts.join('\n\n'), compare };
  }

  /** Jawaban run jadwal on_change: dibaca penandanya, dan penanda diganti kalimat biasa di pesan. */
  async function settleChange(runId: string): Promise<boolean> {
    const [answer] = await db
      .select()
      .from(messages)
      .where(and(eq(messages.runId, runId), eq(messages.author, 'assistant')))
      .orderBy(desc(messages.id))
      .limit(1);
    if (!answer) return true;
    const text = answer.parts.map((p) => (p.type === 'text' ? p.text : '')).join('\n');
    const { changed, display } = readChange(text);
    if (!changed) {
      await db
        .update(messages)
        .set({
          parts: [
            ...answer.parts.filter((p) => p.type !== 'text'),
            { type: 'text', text: display },
          ],
        })
        .where(eq(messages.id, answer.id));
    }
    return changed;
  }

  /* ---- eksekusi ---- */

  interface Started {
    scheduleRunId: string;
    runId: string | null;
    /** Menunggu run selesai, menyimpan hasil, lalu menutup schedule_runs. Tidak melempar. */
    finish(): Promise<void>;
  }

  /** Memulai satu run. Melempar AppError 409 bila jadwal ini sudah punya run yang berjalan (singleton). */
  async function begin(row: ScheduleRow): Promise<Started> {
    let scheduleRunId: string;
    try {
      const [created] = await db
        .insert(scheduleRuns)
        .values({ scheduleId: row.id, status: 'running', startedAt: new Date(now()) })
        .returning({ id: scheduleRuns.id });
      scheduleRunId = created!.id;
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppError(
          409,
          'schedule_run_in_progress',
          'Jadwal ini masih berjalan. Tunggu selesai dulu.',
        );
      }
      throw err;
    }

    /** Mencatat kegagalan (pesan di percakapan, schedule_runs, event) lalu melempar errornya ke pemanggil. */
    const fail = async (error: AppError, runId: string | null = null): Promise<never> => {
      try {
        const conversationId = await conversationOf(row);
        await addMessages(
          conversationId,
          runId,
          row.prompt,
          { kind: 'failure', text: error.message },
          runId === null,
        );
      } catch (err) {
        log?.error({ err, scheduleId: row.id }, 'gagal menyimpan pesan kegagalan jadwal');
      }
      await finalize(row, scheduleRunId, runId, 'failed');
      throw error;
    };

    // Briefing selalu disusun role Umum; role lain hanya untuk target chat/role.
    const role = row.target === 'briefing' ? 'general' : (row.agentRole ?? 'general');
    const engine = deps.roles.get(role)?.engine;
    const mode: 'research' | 'chat' | 'unavailable' =
      row.target === 'research' || (row.target === 'role' && engine === 'research')
        ? 'research'
        : engine && SCHEDULABLE_ENGINES.has(engine)
          ? 'chat'
          : 'unavailable';
    if (mode === 'unavailable') {
      return fail(
        new AppError(
          400,
          'role_not_schedulable',
          `Role "${role}" tidak bisa dijalankan dari jadwal (butuh worker Windows).`,
        ),
      );
    }

    try {
      const conversationId = await conversationOf(row);

      if (mode === 'chat') {
        const { context, compare } = await contextFor(row, conversationId);
        const { run } = await deps.chat.sendMessage(
          conversationId,
          { parts: [{ type: 'text', text: row.prompt }] },
          context ? { context } : undefined,
        );
        await db
          .update(scheduleRuns)
          .set({ runId: run.id })
          .where(eq(scheduleRuns.id, scheduleRunId));
        return {
          scheduleRunId,
          runId: run.id,
          async finish() {
            const final = await waitFor(
              async () => (await db.select().from(runs).where(eq(runs.id, run.id)))[0],
              (r) => !!r && (TERMINAL_RUN_STATUSES as readonly string[]).includes(r.status),
              CHAT_WAIT_MS,
            );
            try {
              if (final?.status === 'completed') {
                const changed = compare ? await settleChange(run.id) : null;
                await finalize(row, scheduleRunId, run.id, 'succeeded', changed);
              } else {
                const why =
                  final?.error?.message ??
                  (final ? `run ${final.status}` : 'melewati batas waktu menunggu jawaban');
                await addMessages(
                  conversationId,
                  run.id,
                  row.prompt,
                  { kind: 'failure', text: why },
                  false,
                );
                await finalize(row, scheduleRunId, run.id, 'failed');
              }
            } catch (err) {
              log?.error({ err, scheduleId: row.id }, 'gagal menutup run jadwal');
            }
          },
        };
      }

      const job = await deps.research.create({ question: row.prompt, depth: 'standard' });
      if (job.runId) {
        // Run riset ikut berada di percakapan jadwal supaya klien bisa membuka hasilnya dari sana.
        await db.update(runs).set({ conversationId }).where(eq(runs.id, job.runId));
        await db
          .update(scheduleRuns)
          .set({ runId: job.runId })
          .where(eq(scheduleRuns.id, scheduleRunId));
      }
      return {
        scheduleRunId,
        runId: job.runId,
        async finish() {
          const final = await waitFor(
            () => deps.research.get(job.id),
            (j) => ['completed', 'failed', 'cancelled'].includes(j.status),
            RESEARCH_WAIT_MS,
          );
          try {
            if (final?.status === 'completed' && final.reportMd) {
              await addMessages(
                conversationId,
                job.runId,
                row.prompt,
                { kind: 'answer', text: final.reportMd, role: 'researcher' },
                true,
              );
              await finalize(row, scheduleRunId, job.runId, 'succeeded');
            } else {
              const why = job.runId
                ? ((await db.select().from(runs).where(eq(runs.id, job.runId)))[0]?.error
                    ?.message ?? `riset ${final?.status ?? 'melewati batas waktu'}`)
                : 'riset gagal';
              await addMessages(
                conversationId,
                job.runId,
                row.prompt,
                { kind: 'failure', text: why },
                true,
              );
              await finalize(row, scheduleRunId, job.runId, 'failed');
            }
          } catch (err) {
            log?.error({ err, scheduleId: row.id }, 'gagal menutup run jadwal riset');
          }
        },
      };
    } catch (err) {
      if (!(err instanceof AppError))
        log?.error({ err, scheduleId: row.id }, 'jadwal gagal dimulai');
      return fail(
        err instanceof AppError
          ? err
          : new AppError(500, 'schedule_run_failed', 'Gateway gagal memulai jadwal.'),
      );
    }
  }

  /** Dipanggil pg-boss pada tiap kemunculan cron. */
  async function onCron(scheduleId: string) {
    const [row] = await db.select().from(schedules).where(eq(schedules.id, scheduleId));
    if (!row?.enabled) return;
    // Memajukan next_run_at lebih dulu: kemunculan ini sudah ditangani, apa pun hasilnya.
    const [updated] = await db
      .update(schedules)
      .set({ nextRunAt: nextAfter(row), updatedAt: new Date(now()) })
      .where(eq(schedules.id, row.id))
      .returning();
    try {
      const started = await begin(updated ?? row);
      await started.finish();
    } catch (err) {
      if (err instanceof AppError && err.code === 'schedule_run_in_progress') {
        // Run sebelumnya belum selesai: kemunculan ini dilewati dan dicatat, bukan ditumpuk.
        const at = new Date(now());
        await db
          .insert(scheduleRuns)
          .values({ scheduleId: row.id, status: 'missed', startedAt: at, finishedAt: at });
        log?.warn({ scheduleId: row.id }, 'jadwal dilewati karena run sebelumnya masih berjalan');
      } else if (!(err instanceof AppError)) {
        log?.error({ err, scheduleId: row.id }, 'pelaksana jadwal error');
      }
    }
  }

  function track<T>(work: Promise<T>): Promise<T> {
    inflight.add(work);
    void work.then(
      () => inflight.delete(work),
      () => inflight.delete(work),
    );
    return work;
  }

  const service: ScheduleService = {
    async start() {
      // Run yang tertinggal 'running' karena gateway mati tidak akan selesai; tutup supaya singleton tidak macet.
      const stale = await db
        .update(scheduleRuns)
        .set({ status: 'failed', finishedAt: new Date(now()) })
        .where(eq(scheduleRuns.status, 'running'))
        .returning({ id: scheduleRuns.id });
      if (stale.length > 0)
        log?.warn({ count: stale.length }, 'run jadwal yang terputus restart ditandai gagal');

      await boss.createQueue(SCHEDULE_QUEUE, {
        policy: 'stately',
        retryLimit: 0,
        expireInSeconds: 3600,
      });
      await service.recordMissed();

      // Cocokkan cron di pg-boss dengan database: jadwal aktif didaftarkan, sisanya dihapus.
      const rows = await db.select().from(schedules);
      const enabled = new Set(rows.filter((r) => r.enabled).map((r) => r.id));
      for (const row of rows) await syncQueue(row);
      for (const entry of await boss.getSchedules(SCHEDULE_QUEUE)) {
        if (!enabled.has(entry.key)) await boss.unschedule(SCHEDULE_QUEUE, entry.key);
      }

      await boss.work<QueueData>(
        SCHEDULE_QUEUE,
        { pollingIntervalSeconds: 1, batchSize: 1, localConcurrency: 3 },
        async (jobs) => {
          for (const job of jobs) await track(onCron(job.data.scheduleId));
        },
      );

      const every = deps.missedCheckMs ?? 5 * 60_000;
      if (every > 0) {
        missedTimer = setInterval(() => {
          service
            .recordMissed()
            .catch((err: unknown) => log?.error({ err }, 'pencatatan jadwal terlewat gagal'));
        }, every);
        missedTimer.unref();
      }
    },

    async parse(text, timezone) {
      try {
        return await deps.parser.parse(text, timezone);
      } catch (err) {
        if (err instanceof CronError) throw new AppError(400, err.code, err.message);
        throw err;
      }
    },

    async list() {
      return (await db.select().from(schedules).orderBy(schedules.id)).map(toScheduleDto);
    },

    async create(input) {
      const agentRole = input.agentRole ?? null;
      const cron = validate({ ...input, agentRole });
      const [conversation] = await db
        .insert(conversations)
        .values({ title: input.name.trim(), surface: SCHEDULE_SURFACE })
        .returning({ id: conversations.id });
      const [row] = await db
        .insert(schedules)
        .values({
          name: input.name.trim(),
          cron,
          timezone: input.timezone,
          prompt: input.prompt.trim(),
          target: input.target,
          agentRole,
          enabled: input.enabled,
          notify: input.notify,
          nextRunAt: input.enabled ? nextAfter({ cron, timezone: input.timezone }) : null,
          conversationId: conversation!.id,
        })
        .returning();
      await syncQueue(row!);
      return toScheduleDto(row!);
    },

    async update(id, patch) {
      const current = await load(id);
      const merged = {
        name: patch.name?.trim() ?? current.name,
        cron: patch.cron ?? current.cron,
        timezone: patch.timezone ?? current.timezone,
        prompt: patch.prompt?.trim() ?? current.prompt,
        target: patch.target ?? current.target,
        agentRole: patch.agentRole === undefined ? current.agentRole : patch.agentRole,
        enabled: patch.enabled ?? current.enabled,
        notify: patch.notify ?? current.notify,
      };
      const cron = validate(merged);
      const [row] = await db
        .update(schedules)
        .set({
          ...merged,
          cron,
          nextRunAt: merged.enabled ? nextAfter({ cron, timezone: merged.timezone }) : null,
        })
        .where(eq(schedules.id, id))
        .returning();
      if (patch.name && current.conversationId) {
        await db
          .update(conversations)
          .set({ title: merged.name })
          .where(eq(conversations.id, current.conversationId));
      }
      await syncQueue(row!);
      return toScheduleDto(row!);
    },

    async remove(id) {
      const row = await load(id);
      await boss.unschedule(SCHEDULE_QUEUE, id);
      // Percakapan hasil tetap ada sebagai arsip; jadwalnya dan riwayat run-nya dihapus.
      if (row.conversationId) {
        await db
          .update(conversations)
          .set({ archivedAt: new Date(now()) })
          .where(eq(conversations.id, row.conversationId));
      }
      await db.delete(schedules).where(eq(schedules.id, id));
    },

    async runNow(id) {
      const row = await load(id);
      const started = await begin(row);
      void track(started.finish());
      if (!started.runId) throw new AppError(500, 'schedule_run_failed', 'Run tidak terbentuk.');
      const [run] = await db.select().from(runs).where(eq(runs.id, started.runId));
      return toRunDto(run!);
    },

    async history(id, q) {
      await load(id);
      const rows = await db
        .select()
        .from(scheduleRuns)
        .where(
          and(
            eq(scheduleRuns.scheduleId, id),
            q.before ? lt(scheduleRuns.id, q.before) : undefined,
          ),
        )
        .orderBy(desc(scheduleRuns.id))
        .limit(q.limit + 1);
      const items = rows.slice(0, q.limit);
      return {
        items: items.map(toRunHistoryDto),
        nextBefore: rows.length > q.limit ? (items.at(-1)?.id ?? null) : null,
      };
    },

    async recordMissed() {
      const current = new Date(now());
      const cutoff = new Date(current.getTime() - MISSED_GRACE_MS);
      const rows = await db.select().from(schedules).where(eq(schedules.enabled, true));
      let recorded = 0;
      for (const row of rows) {
        if (!row.nextRunAt || row.nextRunAt > cutoff) continue;
        // nextRunAt sendiri adalah kemunculan yang tidak pernah dijalankan; hitung dari sesaat sebelumnya.
        const missed = occurrencesBetween(
          row.cron,
          row.timezone,
          new Date(row.nextRunAt.getTime() - 1000),
          cutoff,
          MAX_MISSED_ROWS,
        );
        if (missed.latest.length > 0) {
          await db.insert(scheduleRuns).values(
            missed.latest.map((at) => ({
              scheduleId: row.id,
              status: 'missed' as const,
              startedAt: at,
              finishedAt: at,
            })),
          );
          recorded += missed.latest.length;
          log?.warn(
            { scheduleId: row.id, missed: missed.total, recorded: missed.latest.length },
            'jadwal terlewat saat gateway tidak berjalan',
          );
        }
        // Dari batas toleransi, bukan sekarang: kemunculan dalam 2 menit terakhir masih boleh dijalankan cron.
        await db
          .update(schedules)
          .set({ nextRunAt: nextAfter(row, cutoff) })
          .where(eq(schedules.id, row.id));
      }
      return recorded;
    },

    async idle() {
      await Promise.all([...inflight]);
    },

    async close() {
      clearInterval(missedTimer);
      stopping.abort();
      await Promise.all([...inflight].map((p) => p.catch(() => undefined)));
    },
  };
  return service;
}
