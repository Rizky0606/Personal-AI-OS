import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../testing/db.js';
import { evaluateMemoryRecall, seedMemoryEval, type MemoryEvalReport } from './eval-memory.run.js';

/**
 * Regresi recall leksikal pada set evaluasi (bagian deterministik `pnpm eval:memory`). Angka dicatat saat slice 1
 * selesai: recall@12 kategori "cocok kata" = 100%. Boleh naik, tidak boleh turun.
 */
const LEXICAL_KATA_RECALL_AT_12 = 1;

let database: TestDatabase;
let report: MemoryEvalReport;

beforeAll(async () => {
  database = await createTestDatabase(inject('testDatabaseUrl'));
  const keyOf = await seedMemoryEval(database.handle.db);
  report = await evaluateMemoryRecall(database.handle.db, keyOf);
});

afterAll(async () => {
  await database.drop();
});

describe('eval:memory (regresi recall leksikal)', () => {
  it(`recall@12 leksikal kategori "cocok kata" tidak turun dari ${LEXICAL_KATA_RECALL_AT_12 * 100}%`, () => {
    expect(report.lexical.byCategory.kata.recallAt12).toBeGreaterThanOrEqual(
      LEXICAL_KATA_RECALL_AT_12,
    );
  });

  it('mode lexical tidak pernah melewati anggaran; mode all menyuntik semua fakta', () => {
    expect(report.lexical.overall.avgChars).toBeLessThanOrEqual(report.budgetChars);
    expect(report.all.recallAt12).toBe(1);
    expect(report.all.avgChars).toBeGreaterThan(report.budgetChars);
  });
});
