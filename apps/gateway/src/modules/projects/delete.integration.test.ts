import {
  ConversationSchema,
  LoginResponseSchema,
  ProblemSchema,
  ProjectSchema,
} from '@aios/contracts';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { auditLog, conversations, messages, runs, tasks } from '../../db/schema/index.js';
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
const problem = (res: { json(): unknown }) => ProblemSchema.parse(res.json());
const del = (url: string) =>
  env.app.inject({
    method: 'DELETE',
    url: `/v1${url}`,
    headers: { authorization: `Bearer ${token}` },
  });

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

async function conversation(projectId?: string) {
  const conv = ConversationSchema.parse(
    (
      await env.post(
        '/conversations',
        { surface: 'windows', ...(projectId ? { projectId } : {}) },
        token,
      )
    ).json(),
  );
  await db()
    .insert(messages)
    .values({ conversationId: conv.id, author: 'user', parts: [{ type: 'text', text: 'halo' }] });
  return conv;
}

describe('DELETE /conversations/:id', () => {
  it('tanpa permanent: diarsipkan; permanent=true: percakapan dan pesannya hilang', async () => {
    const archived = await conversation();
    expect((await del(`/conversations/${archived.id}`)).statusCode).toBe(204);
    const [row] = await db().select().from(conversations).where(eq(conversations.id, archived.id));
    expect(row?.archivedAt).not.toBeNull();

    const gone = await conversation();
    expect((await del(`/conversations/${gone.id}?permanent=true`)).statusCode).toBe(204);
    expect(await db().select().from(conversations).where(eq(conversations.id, gone.id))).toEqual(
      [],
    );
    expect(await db().select().from(messages).where(eq(messages.conversationId, gone.id))).toEqual(
      [],
    );
    expect((await del(`/conversations/${gone.id}?permanent=true`)).statusCode).toBe(404);
  });

  it('jawaban masih berjalan: 409 run_in_progress dan percakapan tetap ada', async () => {
    const busy = await conversation();
    await db()
      .insert(runs)
      .values({ kind: 'chat', engine: 'hermes', status: 'running', conversationId: busy.id });
    const res = await del(`/conversations/${busy.id}?permanent=true`);
    expect(res.statusCode).toBe(409);
    expect(problem(res).code).toBe('run_in_progress');
    expect(
      await db().select().from(conversations).where(eq(conversations.id, busy.id)),
    ).toHaveLength(1);
  });
});

describe('DELETE /projects/:id', () => {
  it('kartu kanban ikut terhapus, percakapan project menjadi chat biasa, tercatat di audit', async () => {
    const p = await project('hapus-saya');
    const [card] = await db().insert(tasks).values({ projectId: p.id, title: 'Kartu' }).returning();
    const chat = await conversation(p.id);

    expect((await del(`/projects/${p.id}`)).statusCode).toBe(204);
    expect(await db().select().from(tasks).where(eq(tasks.id, card!.id))).toEqual([]);
    const [row] = await db().select().from(conversations).where(eq(conversations.id, chat.id));
    expect(row?.projectId).toBeNull();
    const audit = await db().select().from(auditLog).where(eq(auditLog.action, 'project.deleted'));
    expect(audit.map((a) => a.target)).toContain(`project:${p.id}`);
    expect((await del(`/projects/${p.id}`)).statusCode).toBe(404);
  });

  it('masih ada run berjalan (lewat kartu atau percakapan project): 409 project_busy', async () => {
    const p = await project('sibuk');
    const [card] = await db().insert(tasks).values({ projectId: p.id, title: 'Jalan' }).returning();
    await db()
      .insert(runs)
      .values({ kind: 'coding', engine: 'omp', status: 'running', taskId: card!.id });
    const res = await del(`/projects/${p.id}`);
    expect(res.statusCode).toBe(409);
    expect(problem(res).code).toBe('project_busy');

    // Run yang menunggu review tidak menahan penghapusan.
    await db().update(runs).set({ status: 'needs_review' }).where(eq(runs.taskId, card!.id));
    expect((await del(`/projects/${p.id}`)).statusCode).toBe(204);
  });
});
