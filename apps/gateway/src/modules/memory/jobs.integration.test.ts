import { sql } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { uuidv7 } from '../../lib/uuidv7.js';
import { createTestDatabase, type TestDatabase } from '../../testing/db.js';
import { MEMORY_EXTRACT_QUEUE, memoryExtractEnqueue, startMemoryExtractJobs } from './jobs.js';

let database: TestDatabase;
let boss: PgBoss;

beforeAll(async () => {
  database = await createTestDatabase(inject('testDatabaseUrl'), false);
  boss = new PgBoss({ connectionString: database.url, schema: 'pgboss', max: 2 });
  await boss.start();
});
afterAll(async () => {
  await boss.stop({ graceful: false, timeout: 5000 });
  await database.drop();
});

describe('pekerjaan memory-extract (pg-boss)', () => {
  it('giliran cepat di satu percakapan menjadi satu ekstraksi; percakapan lain tetap jalan', async () => {
    const calls: string[] = [];
    // Target lib TypeScript repo belum memuat Promise.withResolvers.
    let resolveSettled: () => void = () => undefined;
    const settled = new Promise<void>((resolve) => (resolveSettled = resolve));
    await startMemoryExtractJobs({
      boss,
      pollingIntervalSeconds: 0.5,
      proposals: {
        extract(conversationId) {
          calls.push(conversationId);
          if (calls.length === 2) resolveSettled();
          return Promise.resolve(0);
        },
      },
    });
    const enqueue = memoryExtractEnqueue(boss, 1);
    const a = uuidv7();
    const b = uuidv7();
    await enqueue(a);
    await enqueue(a);
    await enqueue(a);
    await enqueue(b);
    // Kebijakan stately + singletonKey: hanya satu yang mengantre per percakapan, kiriman berikutnya dibuang.
    const jobs = await database.handle.db.execute<{ key: string; n: number }>(
      sql`select singleton_key as key, count(*)::int as n from pgboss.job
          where name = ${MEMORY_EXTRACT_QUEUE} group by singleton_key`,
    );
    expect(Object.fromEntries(jobs.rows.map((r) => [r.key, r.n]))).toEqual({ [a]: 1, [b]: 1 });
    await settled;
    expect(calls.sort()).toEqual([a, b].sort());
  });
});
