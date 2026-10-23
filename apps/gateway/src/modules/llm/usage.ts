import type { QuotaSchema, Usage } from '@aios/contracts';
import { eq, sql } from 'drizzle-orm';
import { Transform, type TransformCallback } from 'node:stream';
import type { z } from 'zod';
import type { Database } from '../../db/client.js';
import { runs } from '../../db/schema/index.js';

type Quota = z.infer<typeof QuotaSchema>;

const count = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(Math.trunc(v), 2 ** 40) : 0;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Membaca `usage` gaya OpenAI (`prompt_tokens`) dan gaya Anthropic/Responses (`input_tokens`). */
export function parseUsage(raw: unknown): Usage | null {
  if (!isRecord(raw)) return null;
  const inputDetails = isRecord(raw.prompt_tokens_details)
    ? raw.prompt_tokens_details
    : isRecord(raw.input_tokens_details)
      ? raw.input_tokens_details
      : {};
  const outputDetails = isRecord(raw.completion_tokens_details)
    ? raw.completion_tokens_details
    : isRecord(raw.output_tokens_details)
      ? raw.output_tokens_details
      : {};
  const usage: Usage = {
    inputTokens: count(raw.prompt_tokens ?? raw.input_tokens),
    outputTokens: count(raw.completion_tokens ?? raw.output_tokens),
  };
  const reasoning = count(outputDetails.reasoning_tokens);
  const cached = count(inputDetails.cached_tokens ?? raw.cache_read_input_tokens);
  if (reasoning) usage.reasoningTokens = reasoning;
  if (cached) usage.cachedTokens = cached;
  return usage.inputTokens || usage.outputTokens ? usage : null;
}

/** Objek yang membawa usage: respons biasa, event stream OpenAI, `message_*` Anthropic, `response.*`. */
export function usageFromPayload(payload: unknown): Usage | null {
  if (!isRecord(payload)) return null;
  const inner = (v: unknown) => (isRecord(v) ? v.usage : undefined);
  return (
    parseUsage(payload.usage) ??
    parseUsage(inner(payload.response)) ??
    parseUsage(inner(payload.message))
  );
}

/** Event stream melaporkan sebagian (input di awal, output di akhir): ambil nilai terbesar per field. */
export function mergeUsage(a: Usage | null, b: Usage | null): Usage | null {
  if (!a || !b) return a ?? b;
  const merged: Usage = {
    inputTokens: Math.max(a.inputTokens, b.inputTokens),
    outputTokens: Math.max(a.outputTokens, b.outputTokens),
  };
  const reasoning = Math.max(a.reasoningTokens ?? 0, b.reasoningTokens ?? 0);
  const cached = Math.max(a.cachedTokens ?? 0, b.cachedTokens ?? 0);
  if (reasoning) merged.reasoningTokens = reasoning;
  if (cached) merged.cachedTokens = cached;
  return merged;
}

export interface UsageRecorder {
  /** Menambahkan usage ke run. Mengembalikan false bila run tidak ada. */
  record(runId: string, usage: Usage): Promise<boolean>;
}

export function createUsageRecorder(db: Database): UsageRecorder {
  return {
    async record(runId, usage) {
      // Satu statement: dua panggilan model dalam satu run tidak saling menimpa.
      const add = (field: string, delta: number) =>
        sql`coalesce((${runs.usage}->>${field}::text)::bigint, 0) + ${delta}::bigint`;
      const rows = await db
        .update(runs)
        .set({
          usage: sql`jsonb_strip_nulls(jsonb_build_object(
            'inputTokens', ${add('inputTokens', usage.inputTokens)},
            'outputTokens', ${add('outputTokens', usage.outputTokens)},
            'reasoningTokens', nullif(${add('reasoningTokens', usage.reasoningTokens ?? 0)}, 0),
            'cachedTokens', nullif(${add('cachedTokens', usage.cachedTokens ?? 0)}, 0)))`,
        })
        .where(eq(runs.id, runId))
        .returning({ id: runs.id });
      return rows.length > 0;
    },
  };
}

/** Meneruskan byte stream apa adanya sambil mengintip baris SSE `data:` untuk mengambil usage. */
export class SseUsageTap extends Transform {
  usage: Usage | null = null;
  private pending = '';
  private done = false;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly onFinish: (usage: Usage | null) => void,
    private readonly idle?: { ms: number; onIdle: () => void },
  ) {
    super();
    this.armIdle();
  }

  private armIdle() {
    clearTimeout(this.timer);
    if (this.idle && !this.done) {
      const { ms, onIdle } = this.idle;
      this.timer = setTimeout(() => {
        onIdle();
        this.destroy(new Error('stream model tidak aktif'));
      }, ms);
    }
  }

  private scan(line: string) {
    if (!line.startsWith('data:') || !line.includes('usage')) return;
    try {
      this.usage = mergeUsage(this.usage, usageFromPayload(JSON.parse(line.slice(5).trim())));
    } catch {
      // Baris data bukan JSON (mis. [DONE]) atau terpotong: abaikan.
    }
  }

  private finish() {
    clearTimeout(this.timer);
    if (this.done) return;
    this.done = true;
    this.onFinish(this.usage);
  }

  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback) {
    this.armIdle();
    this.pending += chunk.toString('utf8');
    const lines = this.pending.split('\n');
    this.pending = lines.pop() ?? '';
    for (const line of lines) this.scan(line.trimEnd());
    cb(null, chunk);
  }

  override _flush(cb: TransformCallback) {
    this.scan(this.pending.trimEnd());
    this.finish();
    cb();
  }

  override _destroy(err: Error | null, cb: (error?: Error | null) => void) {
    this.finish();
    cb(err);
  }
}

/* Ringkasan kuota dari tabel runs (dipakai bila 9Router tidak menyediakan usage). */

export interface QuotaService {
  summary(): Promise<Quota>;
}

export const QUOTA_WINDOW_DAYS = 30;
const TIME_ZONE = 'Asia/Jakarta';

interface Row {
  key: string;
  requests: number;
  input: number;
  output: number;
}

export function createQuotaService(db: Database, now: () => number = Date.now): QuotaService {
  const since = () => new Date(now() - QUOTA_WINDOW_DAYS * 86_400_000);
  const aggregate = (key: ReturnType<typeof sql>) =>
    db
      .select({
        key: sql<string>`${key}`,
        requests: sql<number>`count(*)::int`,
        input: sql<number>`coalesce(sum((${runs.usage}->>'inputTokens')::bigint), 0)::float8`,
        output: sql<number>`coalesce(sum((${runs.usage}->>'outputTokens')::bigint), 0)::float8`,
      })
      .from(runs)
      .where(sql`${runs.createdAt} >= ${since()}`)
      .groupBy(sql`1`)
      // Urutan ditentukan di TypeScript: collation Postgres berbeda antar-instalasi.
      .then((rows) => rows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)));

  // Biaya tidak ada di usage run, jadi costUsd selalu 0 sampai ada sumber biaya.
  const toTotals = (r: Pick<Row, 'requests' | 'input' | 'output'>) => ({
    requests: r.requests,
    inputTokens: r.input,
    outputTokens: r.output,
    costUsd: 0,
  });

  return {
    async summary() {
      const [byModel, byDay] = await Promise.all([
        aggregate(sql`coalesce(${runs.model}, '(tidak diketahui)')`),
        aggregate(sql`to_char(${runs.createdAt} at time zone ${TIME_ZONE}, 'YYYY-MM-DD')`),
      ]);
      const sum = (rows: Row[]) =>
        rows.reduce(
          (t, r) => ({
            requests: t.requests + r.requests,
            input: t.input + r.input,
            output: t.output + r.output,
          }),
          { requests: 0, input: 0, output: 0 },
        );
      return {
        source: 'runs',
        totals: toTotals(sum(byModel)),
        byModel: byModel.map((r) => ({ model: r.key, ...toTotals(r) })),
        byDay: byDay.map((r) => ({ date: r.key, ...toTotals(r) })),
      };
    },
  };
}
