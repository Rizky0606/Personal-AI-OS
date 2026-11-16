/**
 * Evaluasi recall memori (docs/DESIGN_MEMORI_SEMANTIK.md bagian 5). Bukan gerbang CI.
 *
 *   pnpm eval:memory [--budget=N] [--top-k=N]
 *
 * Membuat database sekali-pakai di server Postgres `EVAL_DATABASE_URL` (atau `TEST_DATABASE_URL`, URL admin yang
 * sama dengan tes integrasi), menjalankan migrasi, mengisi fakta sintetis dari `eval-memory.data.ts`, lalu
 * menjalankan recall gateway yang sebenarnya untuk tiap kueri. Database dihapus lagi di akhir. Tidak ada panggilan
 * model atau jaringan selain ke Postgres itu.
 *
 * Mode: `all` (garis dasar: semua fakta ikut), `lexical` (tersemat, cocok kata, terbaru). `hybrid` dilewati:
 * recall vektor belum ada (slice 2).
 */
import { createTestDatabase } from '../testing/db.js';
import { evaluateMemoryRecall, seedMemoryEval, type ModeMetrics } from './eval-memory.run.js';

const argv = process.argv.slice(2);
const flag = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const numberFlag = (name: string) => {
  const raw = flag(name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0)
    throw new Error(`--${name} harus bilangan bulat positif`);
  return value;
};

const adminUrl = process.env.EVAL_DATABASE_URL ?? process.env.TEST_DATABASE_URL ?? '';
if (!adminUrl) {
  console.error(
    'Isi EVAL_DATABASE_URL atau TEST_DATABASE_URL dengan URL admin Postgres 16 (database sekali-pakai dibuat dan dihapus di sana).',
  );
  process.exit(2);
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const line = (label: string, m: ModeMetrics) =>
  [
    label.padEnd(16),
    String(m.queries).padStart(3),
    pct(m.recallAt5).padStart(8),
    pct(m.recallAt12).padStart(8),
    pct(m.precisionAt12).padStart(8),
    m.mrr.toFixed(3).padStart(7),
    pct(m.negativeInjectionRate).padStart(8),
    Math.round(m.avgChars).toString().padStart(7),
  ].join(' ');

const database = await createTestDatabase(adminUrl);
try {
  const keyOf = await seedMemoryEval(database.handle.db);
  const report = await evaluateMemoryRecall(database.handle.db, keyOf, {
    budgetChars: numberFlag('budget'),
    topK: numberFlag('top-k'),
  });
  console.log(
    `Recall memori: ${report.facts} fakta, anggaran ${report.budgetChars} karakter, top-k ${report.topK}\n`,
  );
  console.log('mode/kategori      n   rec@5   rec@12  prec@12    MRR  negatif   karakter');
  console.log(line('all', report.all));
  console.log(line('lexical', report.lexical.overall));
  for (const [category, metrics] of Object.entries(report.lexical.byCategory)) {
    console.log(line(`  ${category}`, metrics));
  }
  console.log('hybrid           dilewati: recall vektor belum ada (slice 2, EMBEDDING_MODEL)');
  console.log(
    '\nCatatan: pada `all` semua fakta ikut sekaligus (recall 1, biaya karakter penuh); "negatif" = kueri tanpa memori relevan yang tetap mendapat fakta (pada `lexical`: karena cocok kata).',
  );
} finally {
  await database.drop();
}
