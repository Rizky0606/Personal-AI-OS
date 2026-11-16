import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { MIGRATIONS_FOLDER, runMigrations } from '../../db/migrate.js';
import { uuidv7 } from '../../lib/uuidv7.js';
import { createTestDatabase, type TestDatabase } from '../../testing/db.js';
import { createMemoryRecaller, RECALL_SECTION_HEADER } from './recall.js';

const RECALL_MIGRATION = '0018_memories_recall';

interface Journal {
  entries: { idx: number; tag: string }[];
}

let database: TestDatabase;
let before: string;

beforeAll(async () => {
  database = await createTestDatabase(inject('testDatabaseUrl'), false);
  // Salinan folder migrasi yang berhenti tepat sebelum migrasi recall: keadaan database produksi saat ini.
  before = mkdtempSync(join(tmpdir(), 'aios-migrasi-'));
  cpSync(MIGRATIONS_FOLDER, before, { recursive: true });
  const journalPath = join(before, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as Journal;
  const at = journal.entries.findIndex((entry) => entry.tag === RECALL_MIGRATION);
  expect(at, `${RECALL_MIGRATION} ada di jurnal`).toBeGreaterThan(0);
  writeFileSync(journalPath, JSON.stringify({ ...journal, entries: journal.entries.slice(0, at) }));
});

afterAll(async () => {
  await database.drop();
  rmSync(before, { recursive: true, force: true });
});

describe('migrasi recall memori pada baris yang sudah ada', () => {
  it('baris lama utuh, pinned = false, tsv terisi dan bisa dicari, dan recall langsung bekerja', async () => {
    const { db } = database.handle;
    await migrate(db, { migrationsFolder: before });
    const columnsBefore = await db.execute<{ column_name: string }>(
      sql`select column_name from information_schema.columns where table_name = 'memories'`,
    );
    expect(columnsBefore.rows.map((r) => r.column_name).sort()).toEqual(
      ['created_at', 'enabled', 'id', 'text', 'updated_at'].sort(),
    );

    const allergy = uuidv7();
    const coffee = uuidv7();
    await db.execute(sql`
      insert into memories (id, text, enabled, created_at, updated_at) values
        (${allergy}, 'Saya alergi kacang tanah.', true, '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z'),
        (${coffee}, 'Saya tidak suka kopi.', false, '2026-01-03T00:00:00Z', '2026-01-03T00:00:00Z')`);

    await runMigrations(db);

    const rows = await db.execute<{
      id: string;
      text: string;
      enabled: boolean;
      pinned: boolean;
      created: string;
      updated: string;
      matches: boolean;
    }>(sql`
      select id, text, enabled, pinned,
        to_char(created_at at time zone 'UTC', 'YYYY-MM-DD') as created,
        to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD') as updated,
        tsv @@ to_tsquery('simple', 'alergi:*') as matches
      from memories order by created_at`);
    expect(rows.rows).toEqual([
      {
        id: allergy,
        text: 'Saya alergi kacang tanah.',
        enabled: true,
        pinned: false,
        created: '2026-01-01',
        updated: '2026-01-02',
        matches: true,
      },
      {
        id: coffee,
        text: 'Saya tidak suka kopi.',
        enabled: false,
        pinned: false,
        created: '2026-01-03',
        updated: '2026-01-03',
        matches: false,
      },
    ]);

    const indexes = await db.execute<{ indexdef: string }>(
      sql`select indexdef from pg_indexes where tablename = 'memories' and indexname = 'memories_tsv_idx'`,
    );
    expect(indexes.rows[0]?.indexdef).toContain('USING gin');

    // Anggaran kecil memaksa pemilihan: baris lama harus ditemukan lewat cocok kata tanpa langkah backfill.
    await db.execute(sql`
      insert into memories (id, text) select gen_random_uuid(), 'Catatan pengisi ' || n from generate_series(1, 5) n`);
    const picked = await createMemoryRecaller({
      db,
      budgetChars: RECALL_SECTION_HEADER.length + 60,
      topK: 12,
    }).select('Apa saja alergi saya?');
    expect(picked.mode).toBe('lexical');
    expect(picked.picks[0]).toEqual({
      id: allergy,
      text: 'Saya alergi kacang tanah.',
      via: 'lexical',
    });
  });
});
