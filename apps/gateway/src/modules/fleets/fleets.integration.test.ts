import { FleetResponseSchema, LoginResponseSchema, ProblemSchema } from '@aios/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { conversations, runs } from '../../db/schema/index.js';
import { createAuthEnv, type AuthEnv } from '../../testing/auth-env.js';

let env: AuthEnv;
let desktop: string;

beforeAll(async () => {
  env = await createAuthEnv(inject('testDatabaseUrl'));
  desktop = (await env.loginOk({ kind: 'desktop' })).accessToken;
});
afterAll(async () => {
  await env.close();
});

let seq = 0;
/** Project baru (dengan worker terdaftar, tanpa worker tersambung: run gagal cepat tetapi tetap dibuat). */
async function newProject() {
  const name = `armada-${++seq}`;
  const worker = LoginResponseSchema.parse(
    (await env.post('/devices/worker', { name }, desktop)).json(),
  );
  const project = (
    await env.post(
      '/projects',
      {
        name,
        workerDeviceId: worker.device.id,
        stack: { languages: ['typescript'], frameworks: [] },
      },
      desktop,
    )
  ).json<{ id: string }>();
  return project.id;
}

const fleet = (body: unknown) => env.post('/fleets', body, desktop);

describe('POST /fleets', () => {
  it('memulai tiap tugas sebagai percakapan sendiri di project, dengan judul dari prompt dan run sendiri', async () => {
    const projectId = await newProject();
    const res = await fleet({
      projectId,
      tasks: [
        { prompt: 'Tambahkan dark mode di halaman pengaturan' },
        { prompt: 'Perbaiki validasi email di form login\nDetail: tolak spasi.' },
        { prompt: 'Tulis tes untuk fungsi hitungDiskon' },
      ],
    });
    expect(res.statusCode, res.body).toBe(201);
    const body = FleetResponseSchema.parse(res.json());
    expect(body.failed).toBe(0);
    expect(body.items).toHaveLength(3);
    expect(new Set(body.items.map((i) => i.conversationId)).size).toBe(3);
    expect(new Set(body.items.map((i) => i.run.id)).size).toBe(3);
    expect(body.items.map((i) => i.title)).toEqual([
      'Tambahkan dark mode di halaman pengaturan',
      'Perbaiki validasi email di form login',
      'Tulis tes untuk fungsi hitungDiskon',
    ]);

    const rows = await env.database.handle.db.select().from(conversations);
    for (const item of body.items) {
      expect(rows.find((c) => c.id === item.conversationId)).toMatchObject({
        projectId,
        title: item.title,
        surface: 'windows',
      });
    }
    // Tiap percakapan memuat prompt lengkap tugasnya sebagai pesan pemilik.
    const messages = (
      await env.get(`/conversations/${body.items[1]!.conversationId}/messages`, desktop)
    ).json<{ items: { author: string; parts: { text?: string }[] }[] }>().items;
    expect(messages.find((m) => m.author === 'user')?.parts[0]?.text).toContain('tolak spasi.');
  });

  it('planOnly diteruskan ke semua run', async () => {
    const projectId = await newProject();
    const body = FleetResponseSchema.parse(
      (
        await fleet({
          projectId,
          planOnly: true,
          tasks: [
            { prompt: 'Rencanakan migrasi database' },
            { prompt: 'Rencanakan refactor auth' },
          ],
        })
      ).json(),
    );
    // DTO baru melaporkan planOnly setelah run menjadi coding; kolomnya sudah terisi sejak dibuat.
    const rows = await env.database.handle.db.select().from(runs);
    for (const item of body.items) {
      expect(rows.find((r) => r.id === item.run.id)?.planOnly).toBe(true);
    }
  });

  it('dibatasi 4 agent yang berjalan sekaligus per project: ditolak 409 fleet_busy bila melebihi', async () => {
    const projectId = await newProject();
    const db = env.database.handle.db;
    // Tiga run yang masih berjalan di project ini (mis. dari kartu kanban atau chat biasa).
    for (let i = 0; i < 3; i++) {
      const [conv] = await db
        .insert(conversations)
        .values({ title: `lama ${i}`, surface: 'windows', projectId })
        .returning({ id: conversations.id });
      await db
        .insert(runs)
        .values({ kind: 'coding', engine: 'omp', status: 'running', conversationId: conv!.id });
    }

    const tooMany = await fleet({
      projectId,
      tasks: [{ prompt: 'tugas satu' }, { prompt: 'tugas dua' }],
    });
    expect(tooMany.statusCode).toBe(409);
    const problem = ProblemSchema.parse(tooMany.json());
    expect(problem.code).toBe('fleet_busy');
    expect(problem.detail ?? problem.title).toContain('3 agent');

    // Sisa satu slot masih bisa dipakai.
    const one = await fleet({ projectId, tasks: [{ prompt: 'tugas terakhir' }] });
    expect(one.statusCode, one.body).toBe(201);
  });

  it('run yang menunggu tinjauan atau sudah selesai tidak menghabiskan slot', async () => {
    const projectId = await newProject();
    const db = env.database.handle.db;
    for (const status of ['needs_review', 'completed', 'failed', 'cancelled'] as const) {
      const [conv] = await db
        .insert(conversations)
        .values({ title: status, surface: 'windows', projectId })
        .returning({ id: conversations.id });
      await db
        .insert(runs)
        .values({ kind: 'coding', engine: 'omp', status, conversationId: conv!.id });
    }
    const res = await fleet({
      projectId,
      tasks: [{ prompt: 'a' }, { prompt: 'b' }, { prompt: 'c' }, { prompt: 'd' }],
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(FleetResponseSchema.parse(res.json()).items).toHaveLength(4);
  });

  it('galat: project tidak ada 404, lebih dari 4 tugas atau tugas kosong 400, tanpa token 401', async () => {
    const projectId = await newProject();
    expect(
      (
        await fleet({
          projectId: '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f',
          tasks: [{ prompt: 'x' }],
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await fleet({
          projectId,
          tasks: ['a', 'b', 'c', 'd', 'e'].map((prompt) => ({ prompt })),
        })
      ).statusCode,
    ).toBe(400);
    expect((await fleet({ projectId, tasks: [{ prompt: '   ' }] })).statusCode).toBe(400);
    expect((await fleet({ projectId, tasks: [] })).statusCode).toBe(400);
    expect((await env.post('/fleets', { projectId, tasks: [{ prompt: 'x' }] })).statusCode).toBe(
      401,
    );
  });
});
