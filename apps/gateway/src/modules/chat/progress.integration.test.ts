import {
  ConversationProgressSchema,
  ConversationSchema,
  FileRecordSchema,
  RunEventsResponseSchema,
  RunSchema,
  SendMessageResponseSchema,
  type AgentEvent,
} from '@aios/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { memories } from '../../db/schema/index.js';
import { createAuthEnv, type AuthEnv } from '../../testing/auth-env.js';
import { startFakeHermes, type FakeHermes } from '../../testing/fake-hermes.js';

let env: AuthEnv;
let hermes: FakeHermes;
let token: string;

beforeAll(async () => {
  hermes = await startFakeHermes();
  env = await createAuthEnv(inject('testDatabaseUrl'), { hermesUrl: hermes.url });
  token = (await env.loginOk({ kind: 'desktop' })).accessToken;
});
afterAll(async () => {
  await env.close();
  await hermes.close();
});
beforeEach(async () => {
  hermes.requests.length = 0;
  hermes.onRequest((s) => {
    s.delta('oke');
    s.finish();
    s.done();
  });
  await env.database.handle.db.delete(memories);
});

const newConversation = async () =>
  ConversationSchema.parse(
    (await env.post('/conversations', { surface: 'windows' }, token)).json(),
  );

async function sendAndFinish(conversationId: string, parts: unknown[], extra: object = {}) {
  const res = await env.post(
    `/conversations/${conversationId}/messages`,
    { parts, ...extra },
    token,
  );
  expect(res.statusCode, res.body).toBe(201);
  const sent = SendMessageResponseSchema.parse(res.json());
  const deadline = Date.now() + 30_000;
  for (;;) {
    const run = RunSchema.parse((await env.get(`/runs/${sent.run.id}`, token)).json());
    if (['completed', 'failed', 'cancelled'].includes(run.status) || Date.now() > deadline) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  return sent.run.id;
}

const progress = async (conversationId: string) => {
  const res = await env.get(`/conversations/${conversationId}/progress`, token);
  expect(res.statusCode, res.body).toBe(200);
  return ConversationProgressSchema.parse(res.json());
};

const eventsOf = async (runId: string) =>
  RunEventsResponseSchema.parse((await env.get(`/runs/${runId}/events`, token)).json()).items;

async function upload(name: string, text: string) {
  const form = new FormData();
  form.append('file', new Blob([text], { type: 'text/plain' }), name);
  const body = new Response(form);
  const res = await env.app.inject({
    method: 'POST',
    url: '/v1/files',
    headers: {
      'content-type': body.headers.get('content-type')!,
      authorization: `Bearer ${token}`,
    },
    payload: Buffer.from(await body.arrayBuffer()),
  });
  expect(res.statusCode, res.body).toBe(201);
  return FileRecordSchema.parse(res.json());
}

describe('event context.used', () => {
  it('dikirim sekali saat run mulai: role, engine, skill, memori (jumlah dan judul singkat), lampiran', async () => {
    const long = 'Saya suka jawaban singkat dan langsung ke inti, tanpa basa-basi pembuka apa pun.';
    for (const text of [long, 'Pakai bahasa Indonesia.', 'Zona waktu Asia/Jakarta.']) {
      expect((await env.post('/memories', { text }, token)).statusCode).toBe(201);
    }
    const file = await upload('catatan.txt', 'isi lampiran rahasia');
    const conv = await newConversation();
    const runId = await sendAndFinish(
      conv.id,
      [
        { type: 'text', text: 'Tolong baca lampiran.' },
        { type: 'file', fileId: file.id, name: file.name, mime: file.mime },
      ],
      { skills: ['plan-progress'] },
    );

    const used = (await eventsOf(runId)).filter((e) => e.event.type === 'context.used');
    expect(used).toHaveLength(1);
    const event = used[0]!.event as Extract<AgentEvent, { type: 'context.used' }>;
    expect(event.runId).toBe(runId);
    expect(event.role).toBe('general');
    expect(event.engine).toBe('hermes');
    expect(event.skills).toContain('plan-progress');
    expect(event.memory.read).toBe(3);
    expect(event.memory.items).toHaveLength(3);
    // Judul singkat (maks. 40 karakter + elipsis), bukan isi lengkap.
    expect(event.memory.items![0]!.title).toBe(`${long.slice(0, 40)}…`);
    expect(event.attachments).toEqual([{ fileId: file.id, name: file.name, mime: file.mime }]);

    // Isi memori dan isi lampiran tidak ikut ke event tersimpan.
    const raw = JSON.stringify(event);
    expect(raw).not.toContain('tanpa basa-basi');
    expect(raw).not.toContain('isi lampiran rahasia');
  });

  it('urutan: context.used setelah route.decided dan sebelum jawaban mengalir', async () => {
    const conv = await newConversation();
    const runId = await sendAndFinish(conv.id, [{ type: 'text', text: 'Halo' }]);
    const types = (await eventsOf(runId)).map((e) => e.event.type);
    expect(types.indexOf('route.decided')).toBeGreaterThanOrEqual(0);
    expect(types.indexOf('context.used')).toBeGreaterThan(types.indexOf('route.decided'));
    expect(types.indexOf('context.used')).toBeLessThan(types.indexOf('message.delta'));
  });

  it('tanpa memori dan lampiran: memory.read 0 tanpa items, attachments kosong', async () => {
    const conv = await newConversation();
    const runId = await sendAndFinish(conv.id, [{ type: 'text', text: 'Halo' }]);
    const event = (await eventsOf(runId)).find((e) => e.event.type === 'context.used')!
      .event as Extract<AgentEvent, { type: 'context.used' }>;
    expect(event.memory).toEqual({ read: 0 });
    expect(event.attachments).toEqual([]);
  });
});

describe('GET /conversations/:id/progress', () => {
  it('percakapan baru tanpa run: kosong', async () => {
    const conv = await newConversation();
    expect(await progress(conv.id)).toEqual({
      plan: null,
      outputs: [],
      used: {
        skills: [],
        openedSkills: [],
        pinnedSkills: [],
        engine: null,
        model: null,
        memory: { read: 0, items: [] },
        attachments: [],
        tools: [],
      },
    });
  });

  it('percakapan tidak ada: 404', async () => {
    const res = await env.get(
      '/conversations/0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f/progress',
      token,
    );
    expect(res.statusCode).toBe(404);
  });

  it('tanpa token: 401', async () => {
    const conv = await newConversation();
    const res = await env.app.inject({
      method: 'GET',
      url: `/v1/conversations/${conv.id}/progress`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('menggabungkan event run tersimpan: rencana terakhir, hasil kerja terbaru dulu, konteks dan alat unik', async () => {
    await env.post('/memories', { text: 'Fakta uji untuk panel progres.' }, token);
    const conv = await newConversation();
    const first = await sendAndFinish(conv.id, [{ type: 'text', text: 'Tugas pertama' }]);
    const second = await sendAndFinish(conv.id, [{ type: 'text', text: 'Tugas kedua' }]);

    const phases = (done: number) => [
      {
        name: 'Rencana',
        tasks: Array.from({ length: 4 }, (_, i) => ({
          content: `Langkah ${i + 1}`,
          status:
            i < done
              ? ('completed' as const)
              : i === done
                ? ('in_progress' as const)
                : ('pending' as const),
        })),
      },
    ];
    const png = await env.app.inject({ method: 'GET', url: '/v1/healthz' });
    expect(png.statusCode).toBe(200);
    const fileA = await upload('hasil.txt', 'a');
    const fileB = await upload('catatan.txt', 'b');

    // Run pertama punya rencana lama; run kedua rencana yang lebih baru (dua pembaruan, yang terakhir dipakai).
    await env.store.append(first, { type: 'todo.updated', phases: phases(1) });
    await env.store.append(second, { type: 'todo.updated', phases: phases(1) });
    await env.store.append(second, { type: 'todo.updated', phases: phases(3) });
    await env.store.append(first, {
      type: 'artifact.created',
      fileId: fileA.id,
      name: 'tangkapan.png',
      mime: 'image/png',
      size: 12,
      sha256: 'a'.repeat(64),
      source: 'screenshot',
    });
    await env.store.append(second, {
      type: 'artifact.created',
      fileId: fileB.id,
      name: 'laporan.md',
      mime: 'text/markdown',
      size: 7,
      sha256: 'b'.repeat(64),
      source: 'file',
    });
    await env.store.append(second, {
      type: 'diff.updated',
      files: [{ path: 'src/a.ts', additions: 4, deletions: 1 }],
    });
    await env.store.append(second, { type: 'tool.started', toolCallId: 't1', name: 'read_file' });
    await env.store.append(second, { type: 'tool.started', toolCallId: 't2', name: 'terminal' });
    await env.store.append(first, { type: 'tool.started', toolCallId: 't3', name: 'read_file' });

    const result = await progress(conv.id);
    expect(result.plan?.runId).toBe(second);
    expect(result.plan?.phases[0]!.tasks.filter((t) => t.status === 'completed')).toHaveLength(3);

    // Terbaru dulu: diff (run kedua, terakhir ditambahkan) sebelum berkas lama.
    expect(result.outputs.map((o) => o.kind)).toEqual(['diff', 'file', 'image']);
    const image = result.outputs.find((o) => o.kind === 'image');
    expect(image).toMatchObject({ name: 'tangkapan.png', mime: 'image/png', runId: first });
    expect(result.outputs.find((o) => o.kind === 'diff')).toMatchObject({
      files: [{ path: 'src/a.ts', additions: 4, deletions: 1 }],
    });

    expect(result.used.engine).toBe('hermes');
    expect(result.used.memory.read).toBe(1);
    expect(result.used.memory.items[0]!.title).toBe('Fakta uji untuk panel progres.');
    expect(result.used.tools).toEqual(['read_file', 'terminal']);
  });

  it('artifact SVG masuk sebagai berkas, bukan gambar (SVG bisa memuat skrip); PNG tetap gambar', async () => {
    const conv = await newConversation();
    const run = await sendAndFinish(conv.id, [{ type: 'text', text: 'Buat diagram' }]);
    const artifact = (fileId: string, name: string, mime: string, source: 'screenshot' | 'file') =>
      env.store.append(run, {
        type: 'artifact.created',
        fileId,
        name,
        mime,
        size: 9,
        sha256: 'c'.repeat(64),
        source,
      });
    const svg = await upload('diagram.svg', '<svg/>');
    const png = await upload('layar.png', 'png');
    await artifact(svg.id, 'diagram.svg', 'image/svg+xml', 'file');
    await artifact(png.id, 'layar.png', 'image/png', 'screenshot');

    const kindOf = async (name: string) =>
      (await progress(conv.id)).outputs.find((o) => 'name' in o && o.name === name)?.kind;
    expect(await kindOf('diagram.svg')).toBe('file');
    expect(await kindOf('layar.png')).toBe('image');
  });

  it('berkas buatan agent di jawaban (bagian file) ikut sebagai output dengan ukurannya', async () => {
    const conv = await newConversation();
    const run = await sendAndFinish(conv.id, [{ type: 'text', text: 'Buat berkas' }]);
    const file = await upload('hasil.txt', 'dua belas bytes');
    const { messages } = await import('../../db/schema/index.js');
    const { eq, and } = await import('drizzle-orm');
    const db = env.database.handle.db;
    const [assistant] = await db
      .select()
      .from(messages)
      .where(and(eq(messages.conversationId, conv.id), eq(messages.author, 'assistant')));
    await db
      .update(messages)
      .set({
        parts: [
          ...assistant!.parts,
          { type: 'file', fileId: file.id, name: file.name, mime: file.mime },
        ],
      })
      .where(eq(messages.id, assistant!.id));

    const result = await progress(conv.id);
    expect(result.outputs).toHaveLength(1);
    expect(result.outputs[0]).toMatchObject({
      kind: 'file',
      fileId: file.id,
      name: 'hasil.txt',
      size: file.size,
      runId: run,
    });
  });

  it('dibatasi 50 output terbaru', async () => {
    const conv = await newConversation();
    const run = await sendAndFinish(conv.id, [{ type: 'text', text: 'Banyak hasil' }]);
    const file = await upload('x.txt', 'x');
    for (let i = 0; i < 60; i++) {
      await env.store.append(run, {
        type: 'artifact.created',
        fileId: file.id,
        name: `hasil-${i}.png`,
        mime: 'image/png',
        size: 1,
        sha256: 'c'.repeat(64),
        source: 'screenshot',
      });
    }
    const result = await progress(conv.id);
    expect(result.outputs).toHaveLength(50);
    expect(result.outputs[0]).toMatchObject({ name: 'hasil-59.png' });
  });

  it('percakapan lain tidak ikut tercampur', async () => {
    const a = await newConversation();
    const b = await newConversation();
    const runA = await sendAndFinish(a.id, [{ type: 'text', text: 'A' }]);
    await sendAndFinish(b.id, [{ type: 'text', text: 'B' }]);
    await env.store.append(runA, { type: 'tool.started', toolCallId: 'x', name: 'bash' });
    expect((await progress(a.id)).used.tools).toEqual(['bash']);
    expect((await progress(b.id)).used.tools).toEqual([]);
  });
});

describe('AuthEnv.activeRunId (pembantu skenario e2e)', () => {
  it('mengembalikan run chat yang sedang berjalan selagi Hermes menahan aliran, dan null sesudahnya', async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let arrived!: () => void;
    const requestSeen = new Promise<void>((r) => (arrived = r));
    hermes.onRequest(async (s) => {
      arrived();
      await held;
      s.delta('oke');
      s.finish();
      s.done();
    });
    const conv = await newConversation();
    const res = await env.post(
      `/conversations/${conv.id}/messages`,
      { parts: [{ type: 'text', text: 'Tahan' }] },
      token,
    );
    const sent = SendMessageResponseSchema.parse(res.json());
    await requestSeen;
    expect(await env.activeRunId()).toBe(sent.run.id);
    release();
    await env.runner.idle();
    expect(await env.activeRunId()).toBeNull();
  });
});
