/**
 * Inti evaluasi recall memori (`pnpm eval:memory` dan tes regresinya): mengisi database kosong dengan fakta
 * fixture, lalu menjalankan recall gateway yang sebenarnya (`createMemoryRecaller`, Postgres `ts_rank_cd`) untuk
 * setiap kueri dan menghitung metrik per mode.
 */
import { memories } from '../db/schema/index.js';
import type { Database } from '../db/client.js';
import { uuidv7 } from '../lib/uuidv7.js';
import { createMemoryRecaller } from '../modules/memory/recall.js';
import {
  MEMORY_EVAL_FACTS,
  MEMORY_EVAL_QUERIES,
  type MemoryEvalCategory,
  type MemoryEvalQuery,
} from './eval-memory.data.js';

/**
 * Anggaran bawaan evaluasi. Fixture hanya ±60 fakta (±4.000 karakter), jadi anggaran produksi 6.000 akan selalu
 * memuat semuanya (mode `all`); anggaran diperkecil sebanding supaya pemilihan benar-benar diuji.
 */
export const EVAL_BUDGET_CHARS = 1500;
export const EVAL_TOP_K = 12;

/** Sama dengan chat service: pesan ini lalu pesan pemilik sebelumnya, dipotong 1.000 karakter. */
export const recallTextOf = (query: MemoryEvalQuery) =>
  [query.text, query.previous ?? ''].filter(Boolean).join('\n').slice(0, 1000);

export interface ModeMetrics {
  queries: number;
  /** Rata-rata bagian fakta relevan yang ada di k butir pertama yang disuntik. */
  recallAt5: number;
  recallAt12: number;
  /** Rata-rata bagian 12 butir pertama yang relevan. */
  precisionAt12: number;
  /** Rata-rata 1/peringkat fakta relevan pertama (0 bila tidak ada). */
  mrr: number;
  /** Bagian kueri negatif yang mendapat fakta karena cocok kata (pada `all`: semua fakta selalu ikut). */
  negativeInjectionRate: number;
  /** Rata-rata panjang bagian memori di pesan sistem (karakter). */
  avgChars: number;
}

export interface MemoryEvalReport {
  budgetChars: number;
  topK: number;
  facts: number;
  all: ModeMetrics;
  lexical: { overall: ModeMetrics; byCategory: Record<MemoryEvalCategory, ModeMetrics> };
}

/** Mengisi tabel memori kosong dengan fixture; terlama dulu, jadi fakta terakhir = paling baru diubah. */
export async function seedMemoryEval(db: Database): Promise<Map<string, string>> {
  const base = Date.parse('2026-01-01T00:00:00Z');
  const rows = MEMORY_EVAL_FACTS.map((fact, i) => ({
    id: uuidv7(),
    text: fact.text,
    pinned: fact.pinned ?? false,
    createdAt: new Date(base + i * 60_000),
    updatedAt: new Date(base + i * 60_000),
  }));
  await db.insert(memories).values(rows);
  return new Map(MEMORY_EVAL_FACTS.map((fact, i) => [rows[i]!.id, fact.key]));
}

interface Outcome {
  /** Kunci fakta yang disuntik, urut prioritas recall. */
  injected: string[];
  /** Ada fakta yang masuk karena cocok kata. */
  lexicalHit: boolean;
  chars: number;
}

function hitsAt(outcome: Outcome, relevant: readonly string[], k: number): number {
  const top = new Set(outcome.injected.slice(0, k));
  return relevant.filter((key) => top.has(key)).length;
}

function summarize(
  rows: { query: MemoryEvalQuery; outcome: Outcome }[],
  everythingRanked: boolean,
): ModeMetrics {
  const positives = rows.filter((r) => r.query.relevant.length > 0);
  const negatives = rows.filter((r) => r.query.relevant.length === 0);
  const avg = (values: number[]) =>
    values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  // Pada mode `all` semua fakta disuntik sekaligus; urutan (terlama dulu) bukan peringkat, jadi k tidak berlaku.
  const k = (n: number) => (everythingRanked ? Number.POSITIVE_INFINITY : n);
  return {
    queries: rows.length,
    recallAt5: avg(
      positives.map((r) => hitsAt(r.outcome, r.query.relevant, k(5)) / r.query.relevant.length),
    ),
    recallAt12: avg(
      positives.map((r) => hitsAt(r.outcome, r.query.relevant, k(12)) / r.query.relevant.length),
    ),
    // Pada `all` penyebutnya semua fakta yang disuntik; selain itu 12 butir teratas.
    precisionAt12: avg(
      positives.map(
        (r) =>
          hitsAt(r.outcome, r.query.relevant, k(12)) /
          Math.max(1, everythingRanked ? r.outcome.injected.length : 12),
      ),
    ),
    mrr: avg(
      positives.map((r) => {
        if (everythingRanked) return 1;
        const rank = r.outcome.injected.findIndex((key) => r.query.relevant.includes(key));
        return rank < 0 ? 0 : 1 / (rank + 1);
      }),
    ),
    negativeInjectionRate: avg(
      negatives.map((r) =>
        everythingRanked ? (r.outcome.injected.length ? 1 : 0) : r.outcome.lexicalHit ? 1 : 0,
      ),
    ),
    avgChars: avg(rows.map((r) => r.outcome.chars)),
  };
}

/** Menjalankan semua kueri fixture pada database yang sudah diisi `seedMemoryEval`. */
export async function evaluateMemoryRecall(
  db: Database,
  keyOf: Map<string, string>,
  options: { budgetChars?: number; topK?: number } = {},
): Promise<MemoryEvalReport> {
  const budgetChars = options.budgetChars ?? EVAL_BUDGET_CHARS;
  const topK = options.topK ?? EVAL_TOP_K;
  const everything = createMemoryRecaller({ db, budgetChars: Number.MAX_SAFE_INTEGER, topK });
  const selective = createMemoryRecaller({ db, budgetChars, topK });

  const run = async (recaller: typeof selective, expectMode: 'all' | 'lexical') => {
    const rows: { query: MemoryEvalQuery; outcome: Outcome }[] = [];
    for (const query of MEMORY_EVAL_QUERIES) {
      const text = recallTextOf(query);
      // `select` memberi semua butir (ringkasan `context.used` dibatasi 50); `recall` memberi panjang bagian.
      const { mode, picks } = await recaller.select(text);
      if (mode !== expectMode) {
        throw new Error(`mode recall ${mode}, diharapkan ${expectMode}; periksa anggaran`);
      }
      const { section } = await recaller.recall({ text });
      rows.push({
        query,
        outcome: {
          // Tersemat selalu ikut dan tidak diperingkat, jadi tidak dihitung dalam peringkat (rec@k, MRR).
          injected: picks
            .filter((pick) => pick.via !== 'pinned')
            .map((pick) => keyOf.get(pick.id) ?? pick.id),
          lexicalHit: picks.some((pick) => pick.via === 'lexical'),
          chars: section.length,
        },
      });
    }
    return rows;
  };

  const allRows = await run(everything, 'all');
  const lexicalRows = await run(selective, 'lexical');
  const categories = [...new Set(MEMORY_EVAL_QUERIES.map((q) => q.category))];
  return {
    budgetChars,
    topK,
    facts: MEMORY_EVAL_FACTS.length,
    all: summarize(allRows, true),
    lexical: {
      overall: summarize(lexicalRows, false),
      byCategory: Object.fromEntries(
        categories.map((c) => [
          c,
          summarize(
            lexicalRows.filter((r) => r.query.category === c),
            false,
          ),
        ]),
      ) as Record<MemoryEvalCategory, ModeMetrics>,
    },
  };
}
