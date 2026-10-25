import {
  ConversationSchema,
  MessageSchema,
  RunSchema,
  SendMessageResponseSchema,
} from '@aios/contracts';
import { desc } from 'drizzle-orm';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { runs } from '../../db/schema/index.js';
import { createAuthEnv, type AuthEnv } from '../../testing/auth-env.js';
import { startFakeHermes, type FakeHermes } from '../../testing/fake-hermes.js';

let env: AuthEnv;
let hermes: FakeHermes;
let token: string;
let outbox: string;

beforeAll(async () => {
  outbox = await mkdtemp(nodePath.join(tmpdir(), 'outbox-int-'));
  hermes = await startFakeHermes();
  env = await createAuthEnv(inject('testDatabaseUrl'), {
    hermesUrl: hermes.url,
    outboxDir: outbox,
  });
  token = (await env.loginOk({ kind: 'desktop' })).accessToken;
});
afterAll(async () => {
  await env.close();
  await hermes.close();
  await rm(outbox, { recursive: true, force: true });
});

describe('berkas buatan agent lewat folder kiriman', () => {
  it('berkas yang ditulis agent ditempel ke jawaban dan bisa diunduh pemilik', async () => {
    // Agent tiruan menulis zip ke folder run (seperti Hermes lewat alat berkasnya) lalu menjawab.
    hermes.onRequest(async (s) => {
      const [run] = await env.database.handle.db
        .select({ id: runs.id })
        .from(runs)
        .orderBy(desc(runs.id))
        .limit(1);
      const folder = nodePath.join(outbox, run!.id);
      await mkdir(folder, { recursive: true });
      await writeFile(nodePath.join(folder, 'todo app.zip'), Buffer.from('PK\u0003\u0004isi'));
      s.delta('Sudah saya buat: todo app.zip.');
      s.finish();
      s.done();
    });

    const conv = ConversationSchema.parse(
      (await env.post('/conversations', { surface: 'windows' }, token)).json(),
    );
    const sent = SendMessageResponseSchema.parse(
      (
        await env.post(
          `/conversations/${conv.id}/messages`,
          { parts: [{ type: 'text', text: 'Buatkan zip todo app' }] },
          token,
        )
      ).json(),
    );
    const deadline = Date.now() + 30_000;
    for (;;) {
      const run = RunSchema.parse((await env.get(`/runs/${sent.run.id}`, token)).json());
      if (run.status === 'completed' || Date.now() > deadline) break;
      await new Promise((r) => setTimeout(r, 20));
    }

    const system = hermes.requests.at(-1)?.body.messages.find((m) => m.role === 'system');
    expect(system?.content).toContain(`${outbox}/${sent.run.id}/`);

    const items = z
      .array(MessageSchema)
      .parse(
        (await env.get(`/conversations/${conv.id}/messages`, token)).json<{ items: unknown[] }>()
          .items,
      );
    const answer = items.at(-1)!;
    const file = answer.parts.find((p) => p.type === 'file');
    expect(file).toMatchObject({ type: 'file', name: 'todo app.zip', mime: 'application/zip' });

    const res = await env.get(
      `/files/${file!.type === 'file' ? file!.fileId : ''}/download`,
      token,
    );
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="todo app.zip"; filename*=UTF-8\'\'todo%20app.zip',
    );
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.rawPayload.toString('latin1')).toBe('PK\u0003\u0004isi');
  });

  it('unduh tanpa token 401; berkas tidak ada 404', async () => {
    const missing = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';
    expect((await env.get(`/files/${missing}/download`)).statusCode).toBe(401);
    expect((await env.get(`/files/${missing}/download`, token)).statusCode).toBe(404);
  });
});
