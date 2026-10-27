import {
  ConversationSchema,
  LoginResponseSchema,
  ProjectSchema,
  RunSchema,
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
  env = await createAuthEnv(inject('testDatabaseUrl'), { hermesUrl: hermes.url });
  token = (await env.loginOk({ kind: 'desktop' })).accessToken;
  hermes.onRequest((s) => {
    s.delta('Siap.');
    s.finish();
    s.done();
  });
});
afterAll(async () => {
  await env.close();
  await hermes.close();
});

const patch = (url: string, payload: object) =>
  env.app.inject({
    method: 'PATCH',
    url: `/v1${url}`,
    payload,
    headers: { authorization: `Bearer ${token}` },
  });

/** Satu giliran chat (role Umum) di project; mengembalikan pesan sistem yang diterima Hermes. */
async function systemPromptInProject(projectId: string) {
  const conv = ConversationSchema.parse(
    (await env.post('/conversations', { surface: 'android', projectId }, token)).json(),
  );
  const sent = SendMessageResponseSchema.parse(
    (
      await env.post(
        `/conversations/${conv.id}/messages`,
        { parts: [{ type: 'text', text: 'Jelaskan struktur project.' }], role: 'general' },
        token,
      )
    ).json(),
  );
  const deadline = Date.now() + 30_000;
  for (;;) {
    const run = RunSchema.parse((await env.get(`/runs/${sent.run.id}`, token)).json());
    if (['completed', 'failed', 'cancelled'].includes(run.status) || Date.now() > deadline) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  return String(
    hermes.requests.at(-1)?.body.messages.find((m) => m.role === 'system')?.content ?? '',
  );
}

describe('aturan project (W23)', () => {
  it('disimpan saat dibuat dan diubah, lalu disuntik ke pesan sistem run di project itu saja', async () => {
    const worker = LoginResponseSchema.parse(
      (await env.post('/devices/worker', { name: 'Worker aturan' }, token)).json(),
    );
    const created = await env.post(
      '/projects',
      {
        name: 'toko-online',
        workerDeviceId: worker.device.id,
        stack: { languages: ['typescript'], frameworks: [] },
        instructions: '  Selalu pakai pnpm. Jalankan pnpm test sebelum selesai.  ',
      },
      token,
    );
    expect(created.statusCode, created.body).toBe(201);
    const project = ProjectSchema.parse(created.json());
    expect(project.instructions).toBe('Selalu pakai pnpm. Jalankan pnpm test sebelum selesai.');

    const prompt = await systemPromptInProject(project.id);
    expect(prompt).toContain('# Aturan project "toko-online"');
    expect(prompt).toContain('Selalu pakai pnpm.');

    const cleared = await patch(`/projects/${project.id}`, { instructions: '' });
    expect(ProjectSchema.parse(cleared.json()).instructions).toBe('');
    expect(await systemPromptInProject(project.id)).not.toContain('# Aturan project');
  });

  it('aturan lebih dari 4000 karakter ditolak', async () => {
    const worker = LoginResponseSchema.parse(
      (await env.post('/devices/worker', { name: 'Worker panjang' }, token)).json(),
    );
    const res = await env.post(
      '/projects',
      {
        name: 'x',
        workerDeviceId: worker.device.id,
        stack: { languages: [], frameworks: [] },
        instructions: 'a'.repeat(4001),
      },
      token,
    );
    expect(res.statusCode).toBe(400);
  });
});
