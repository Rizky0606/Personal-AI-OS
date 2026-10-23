import type { Router, RouteSource } from '../router/index.js';
import type { EvalCase } from './dataset.js';

export interface CaseResult {
  case: EvalCase;
  got: string;
  confidence: number;
  reason: string;
  source: RouteSource;
  correct: boolean;
}

export interface RoleScore {
  role: string;
  total: number;
  correct: number;
  accuracy: number;
}

export interface EvalReport {
  results: CaseResult[];
  perRole: RoleScore[];
  overall: { total: number; correct: number; accuracy: number };
  sources: Record<RouteSource, number>;
}

export const DEFAULT_EVAL_THRESHOLD = 0.9;

/** Menjalankan semua kasus melalui router (aturan cepat + model) dengan konkurensi terbatas. */
export async function evaluate(
  cases: EvalCase[],
  router: Router,
  options: { concurrency?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<EvalReport> {
  const { concurrency = 4, onProgress } = options;
  const results: CaseResult[] = new Array<CaseResult>(cases.length);
  let next = 0;
  let done = 0;

  async function worker() {
    for (;;) {
      const index = next++;
      const item = cases[index];
      if (!item) return;
      const { decision, source } = await router.route({
        message: item.message,
        surface: item.surface,
        ...(item.project ? { project: item.project } : {}),
        ...(item.previousRole ? { previousRole: item.previousRole } : {}),
        ...(item.history ? { history: item.history } : {}),
      });
      results[index] = {
        case: item,
        got: decision.role,
        confidence: decision.confidence,
        reason: decision.reason,
        source,
        correct: decision.role === item.expect,
      };
      onProgress?.(++done, cases.length);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return summarize(results);
}

export function summarize(results: CaseResult[]): EvalReport {
  const byRole = new Map<string, { total: number; correct: number }>();
  const sources: Record<RouteSource, number> = { manual: 0, rule: 0, ai: 0, fallback: 0 };
  for (const r of results) {
    const entry = byRole.get(r.case.expect) ?? { total: 0, correct: 0 };
    entry.total++;
    if (r.correct) entry.correct++;
    byRole.set(r.case.expect, entry);
    sources[r.source]++;
  }
  const perRole = [...byRole.entries()]
    .map(([role, s]) => ({ role, ...s, accuracy: s.correct / s.total }))
    .sort((a, b) => a.role.localeCompare(b.role));
  const correct = results.filter((r) => r.correct).length;
  return {
    results,
    perRole,
    overall: {
      total: results.length,
      correct,
      accuracy: results.length === 0 ? 0 : correct / results.length,
    },
    sources,
  };
}

/** Lulus bila akurasi tiap role dan akurasi keseluruhan minimal `threshold` (PRD: 90% per role). */
export function passes(report: EvalReport, threshold = DEFAULT_EVAL_THRESHOLD): boolean {
  return (
    report.overall.total > 0 &&
    report.overall.accuracy >= threshold &&
    report.perRole.every((r) => r.accuracy >= threshold)
  );
}

/**
 * Model router tidak terjangkau: kasus yang butuh model semuanya jatuh ke fallback. Hasilnya bukan akurasi
 * router, jadi CLI melaporkannya sebagai kegagalan lingkungan.
 */
export function modelUnavailable(report: EvalReport): boolean {
  const needModel = report.sources.ai + report.sources.fallback;
  return needModel > 0 && report.sources.fallback / needModel > 0.5;
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export function formatReport(report: EvalReport, threshold = DEFAULT_EVAL_THRESHOLD): string {
  const lines = ['Role         Benar/Total   Akurasi'];
  for (const r of report.perRole) {
    const mark = r.accuracy >= threshold ? ' ' : '!';
    lines.push(
      `${r.role.padEnd(12)} ${`${r.correct}/${r.total}`.padEnd(13)} ${pct(r.accuracy)} ${mark}`,
    );
  }
  lines.push(
    `${'KESELURUHAN'.padEnd(12)} ${`${report.overall.correct}/${report.overall.total}`.padEnd(13)} ${pct(report.overall.accuracy)}`,
  );
  const s = report.sources;
  lines.push(
    `Sumber keputusan: aturan cepat ${s.rule}, model ${s.ai}, fallback ${s.fallback}, manual ${s.manual}`,
  );
  const failures = report.results.filter((r) => !r.correct);
  if (failures.length > 0) {
    lines.push('', `Salah (${failures.length}):`);
    for (const f of failures) {
      lines.push(
        `  ${f.case.id}: harapan ${f.case.expect}, dapat ${f.got} (${f.confidence.toFixed(2)}, ${f.source}) — "${f.case.message.slice(0, 70)}"`,
      );
    }
  }
  return lines.join('\n');
}
