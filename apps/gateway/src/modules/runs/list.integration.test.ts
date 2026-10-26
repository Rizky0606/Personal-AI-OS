import {
  ConversationSchema,
  LoginResponseSchema,
  ProjectSchema,
  WorkspaceRunListSchema,
} from '@aios/contracts';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { conversations, runs, tasks } from '../../db/schema/index.js';
import { createAuthEnv, type AuthEnv } from '../../testing/auth-env.js';

let env: AuthEnv;
let token: string;

beforeAll(async () => {
  env = await createAuthEnv(inject('testDatabaseUrl'));
  token = (await env.loginOk({ kind: 'desktop' })).accessToken;
});
afterAll(async () => {
  await env.close();
});

const db = () => env.database.handle.db;

async function project(name: string) {
  const worker = LoginResponseSchema.parse(
    (await env.post('/devices/worker', { name: `Worker ${name}` }, token)).json(),
  );
  return ProjectSchema.parse(
    (
      await env.post(
        '/projects',
        { name, workerDeviceId: worker.device.id, stack: { languages: [], frameworks: [] } },
        token,
      )
    ).json(),
  );
}

const list = async (query = '') =>
  WorkspaceRunListSchema.parse((await env.get(`/runs${query}`, token)).json()).items;

describe('GET /runs', () => {
  it('run coding terbaru dulu, dengan judul kartu atau percakapan dan nama project', async () => {
    const p = await project('Aplikasi Todo');
    const [task] = await db()
      .insert(tasks)
      .values({ projectId: p.id, title: 'Tambah dark mode' })
      .returning();
    const conv = ConversationSchema.parse(
      (await env.post('/conversations', { surface: 'windows', projectId: p.id }, token)).json(),
    );
    await db()
      .update(conversations)
      .set({ title: 'Perbaiki login' })
      .where(eq(conversations.id, conv.id));

    await db().insert(runs).values({
      kind: 'coding',
      engine: 'omp',
      status: 'running',
      taskId: task!.id,
    });
    await db().insert(runs).values({
      kind: 'coding',
      engine: 'omp',
      status: 'needs_review',
      conversationId: conv.id,
    });
    await db().insert(runs).values({ kind: 'chat', engine: 'hermes', status: 'completed' });

    const items = await list();
    const mine = items.filter((i) => i.projectId === p.id);
    expect(mine.map((i) => [i.title, i.projectName, i.run.status])).toEqual([
      ['Perbaiki login', 'Aplikasi Todo', 'needs_review'],
      ['Tambah dark mode', 'Aplikasi Todo', 'running'],
    ]);
    expect(items.every((i) => i.run.kind === 'coding')).toBe(true);
  });

  it('kind dan limit menyaring; tanpa token 401; kind tak dikenal 400', async () => {
    expect((await list('?kind=chat')).every((i) => i.run.kind === 'chat')).toBe(true);
    expect(await list('?limit=1')).toHaveLength(1);
    expect((await env.get('/runs')).statusCode).toBe(401);
    expect((await env.get('/runs?kind=lain', token)).statusCode).toBe(400);
  });
});
