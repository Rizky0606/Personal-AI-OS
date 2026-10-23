import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { runs } from '../../db/schema/index.js';
import { createTestDatabase, type TestDatabase } from '../../testing/db.js';
import { createEventHub } from './hub.js';
import { createEventStore } from './store.js';

let database: TestDatabase;
beforeAll(async () => {
  database = await createTestDatabase(inject('testDatabaseUrl'));
});
afterAll(async () => {
  await database.drop();
});

const newRun = async () => {
  const [run] = await database.handle.db
    .insert(runs)
    .values({ kind: 'research', engine: 'research' })
    .returning();
  return run!.id;
};

describe('event store: penulisan bersamaan', () => {
  it('50 append paralel ke satu run mendapat seq 1..50 tanpa tabrakan, sesuai urutan panggilan', async () => {
    const hub = createEventHub();
    const store = createEventStore(database.handle.db, hub);
    const runId = await newRun();
    const published: number[] = [];
    hub.subscribe(`run:${runId}`, (e) => published.push(e.seq));

    const stored = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        store.append(runId, {
          type: 'research.progress',
          stage: 'reading',
          progress: i / 100,
          message: `n${i}`,
        }),
      ),
    );
    expect(stored.map((s) => s.seq)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(published).toEqual(stored.map((s) => s.seq));
    const listed = await store.list(runId, 0, 100);
    expect(listed.map((e) => (e.event as { message: string }).message)).toEqual(
      Array.from({ length: 50 }, (_, i) => `n${i}`),
    );
    expect(await store.head(runId)).toBe(50);
  });

  it('run berbeda tidak saling menunggu atau mengacak seq; kegagalan satu append tidak memblokir berikutnya', async () => {
    const store = createEventStore(database.handle.db, createEventHub());
    const [a, b] = [await newRun(), await newRun()];
    const results = await Promise.all([
      store.append(a, { type: 'run.status', status: 'queued' }),
      store.append(b, { type: 'run.status', status: 'queued' }),
      store.append(a, { type: 'run.status', status: 'routing' }),
      store.append(b, { type: 'run.status', status: 'routing' }),
    ]);
    expect(results.map((r) => r.seq)).toEqual([1, 1, 2, 2]);

    const missing = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';
    const [bad, good] = await Promise.allSettled([
      store.append(missing, { type: 'run.status', status: 'queued' }), // FK ke runs gagal
      store.append(a, { type: 'run.status', status: 'preparing' }),
    ]);
    expect(bad.status).toBe('rejected');
    expect(good).toMatchObject({ status: 'fulfilled', value: { seq: 3 } });
  });
});
