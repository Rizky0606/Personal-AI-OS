import {
  ConversationSchema,
  LoginResponseSchema,
  ProjectSchema,
  SendMessageResponseSchema,
} from '@aios/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createAuthEnv, type AuthEnv } from '../../testing/auth-env.js';
import { startFakeHermes, type FakeHermes } from '../../testing/fake-hermes.js';

let env: AuthEnv;
let hermes: FakeHermes;
let token: string;

beforeAll(async () => {
  hermes = await startFakeHermes();
  hermes.onRequest((stream) => {
    stream.delta('jawaban hermes');
    stream.finish();
    stream.done();
  });
  env = await createAuthEnv(inject('testDatabaseUrl'), { hermesUrl: hermes.url });
  token = (await env.loginOk({ kind: 'desktop' })).accessToken;
});
afterAll(async () => {
  await env.close();
  await hermes.close();
});

async function conversation(withProject: boolean) {
  let projectId: string | undefined;
  if (withProject) {
    const worker = LoginResponseSchema.parse(
      (await env.post('/devices/worker', { name: 'Worker paksa' }, token)).json(),
    );
    projectId = ProjectSchema.parse(
      (
        await env.post(
          '/projects',
          {
            name: 'Proyek paksa',
            workerDeviceId: worker.device.id,
            stack: { languages: [], frameworks: [] },
          },
          token,
        )
      ).json(),
    ).id;
  }
  return ConversationSchema.parse(
    (
      await env.post(
        '/conversations',
        { surface: 'windows', ...(projectId ? { projectId } : {}) },
        token,
      )
    ).json(),
  );
}

const send = (id: string, engine?: string) =>
  env.post(
    `/conversations/${id}/messages`,
    { parts: [{ type: 'text', text: 'halo' }], ...(engine ? { engine } : {}) },
    token,
  );

const finalRun = async (runId: string) => {
  await env.runner.idle();
  return (await env.get(`/runs/${runId}`, token)).json<{
    status: string;
    engine: string;
    agentRole: string | null;
  }>();
};

describe('memaksa mesin per pesan', () => {
  it('omp di chat umum ditolak di muka: 422 project_required, tanpa membuat run', async () => {
    const conv = await conversation(false);
    const res = await send(conv.id, 'omp');
    expect(res.statusCode).toBe(422);
    expect(res.json<{ code: string }>().code).toBe('project_required');
  });

  it('dsh di dalam project tetap ditolak: 422 engine_not_for_project', async () => {
    const conv = await conversation(true);
    const res = await send(conv.id, 'dsh');
    expect(res.statusCode).toBe(422);
    expect(res.json<{ code: string }>().code).toBe('engine_not_for_project');
  });

  it('Hermes dipaksa di dalam project: dijawab Hermes lewat agent umum, bukan agent project (omp)', async () => {
    const conv = await conversation(true);
    const res = await send(conv.id, 'hermes');
    expect(res.statusCode).toBe(201);
    const { run } = SendMessageResponseSchema.parse(res.json());
    expect(await finalRun(run.id)).toMatchObject({
      status: 'completed',
      engine: 'hermes',
      agentRole: 'general',
    });
  });

  it('tanpa pilihan di project, agent project (omp) tetap yang dipilih; Hermes di chat umum tetap bisa dipaksa', async () => {
    const project = await conversation(true);
    const auto = SendMessageResponseSchema.parse((await send(project.id)).json());
    // Tanpa worker tersambung run gagal, tetapi agent dan mesinnya sudah terpilih.
    expect(await finalRun(auto.run.id)).toMatchObject({ engine: 'omp', agentRole: 'project' });

    const general = await conversation(false);
    const forced = SendMessageResponseSchema.parse((await send(general.id, 'hermes')).json());
    expect(await finalRun(forced.run.id)).toMatchObject({
      status: 'completed',
      engine: 'hermes',
      agentRole: 'general',
    });
  });

  it('mesin yang tidak dikenal ditolak 400', async () => {
    const conv = await conversation(false);
    expect((await send(conv.id, 'pi')).statusCode).toBe(400);
  });
});
