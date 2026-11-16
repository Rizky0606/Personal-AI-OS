import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { MIGRATIONS_FOLDER, runMigrations } from '../../db/migrate.js';
import { uuidv7 } from '../../lib/uuidv7.js';
import { createTestDatabase, type TestDatabase } from '../../testing/db.js';
import { createMemoryService } from './service.js';

const PROPOSALS_MIGRATION = '0019_memory_proposals';

interface Journal {
  entries: { idx: number; tag: string }[];
}

let database: TestDatabase;
let before: string;

beforeAll(async () => {
  database = await createTestDatabase(inject('testDatabaseUrl'), false);
  // Salinan folder migrasi yang berhenti tepat sebelum migrasi usulan memori: keadaan produksi sebelum slice 3.
  before = mkdtempSync(join(tmpdir(), 'aios-migrasi-'));
  cpSync(MIGRATIONS_FOLDER, before, { recursive: true });
  const journalPath = join(before, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as Journal;
  const at = journal.entries.findIndex((entry) => entry.tag === PROPOSALS_MIGRATION);
  expect(at, `${PROPOSALS_MIGRATION} ada di jurnal`).toBeGreaterThan(0);
  writeFileSync(journalPath, JSON.stringify({ ...journal, entries: journal.entries.slice(0, at) }));
});

afterAll(async () => {
  await database.drop();
  rmSync(before, { recursive: true, force: true });
});

describe('migrasi usulan memori pada baris yang sudah ada', () => {
  it('memori lama utuh menjadi source owner tanpa asal; tabel usulan dan catatan ekstraksi kosong', async () => {
    const { db } = database.handle;
    await migrate(db, { migrationsFolder: before });

    const allergy = uuidv7();
    const coffee = uuidv7();
    await db.execute(sql`
      insert into memories (id, text, enabled, pinned, created_at, updated_at) values
        (${allergy}, 'Saya alergi kacang tanah.', true, true, '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z'),
        (${coffee}, 'Saya tidak suka kopi.', false, false, '2026-01-03T00:00:00Z', '2026-01-03T00:00:00Z')`);

    await runMigrations(db);

    const memories = await createMemoryService({ db }).list();
    expect(memories).toEqual([
      {
        id: allergy,
        text: 'Saya alergi kacang tanah.',
        enabled: true,
        pinned: true,
        source: 'owner',
        origin: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
      {
        id: coffee,
        text: 'Saya tidak suka kopi.',
        enabled: false,
        pinned: false,
        source: 'owner',
        origin: null,
        createdAt: '2026-01-03T00:00:00.000Z',
        updatedAt: '2026-01-03T00:00:00.000Z',
      },
    ]);

    const counts = await db.execute<{ proposals: number; extractions: number }>(sql`
      select (select count(*)::int from memory_proposals) as proposals,
             (select count(*)::int from memory_extractions) as extractions`);
    expect(counts.rows[0]).toEqual({ proposals: 0, extractions: 0 });

    // Asal memori ikut kosong (set null) bila percakapan asalnya dihapus; memorinya tetap ada.
    const [conversation] = (
      await db.execute<{ id: string }>(
        sql`insert into conversations (id, surface) values (${uuidv7()}, 'windows') returning id`,
      )
    ).rows;
    await db.execute(sql`
      update memories set source = 'extracted', source_conversation_id = ${conversation!.id}
      where id = ${coffee}`);
    await db.execute(sql`delete from conversations where id = ${conversation!.id}`);
    const after = await createMemoryService({ db }).list();
    expect(after.find((m) => m.id === coffee)).toMatchObject({ source: 'extracted', origin: null });
  });
});
