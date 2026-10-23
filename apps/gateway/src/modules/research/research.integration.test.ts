import {
  ProblemSchema,
  ResearchJobDetailSchema,
  ResearchJobSchema,
  RunSchema,
  type AgentEvent,
  type EventEnvelope,
} from '@aios/contracts';
import { eq } from 'drizzle-orm';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { messages, researchJobs, researchSources, runEvents, runs } from '../../db/schema/index.js';
import { createAuthEnv, type AuthEnv } from '../../testing/auth-env.js';
import {
  articleHtml,
  classify,
  scriptedLlmReply,
  type ScriptedLlmOptions,
} from '../../testing/research-fakes.js';
import { startMockServer, type MockServer } from '../../testing/mock-server.js';
import { TestWs } from '../../testing/ws-client.js';
import { checkCitations } from './report.js';
import { createResearchService } from './service.js';

const SITE_COUNT = 16;
const DEPTHS = {
  quick: { target: 3, subQuestions: 3, perQuery: 6, pool: 10, perDomain: 50, totalMs: 40_000 },
  standard: { target: 5, subQuestions: 4, perQuery: 6, pool: 12, perDomain: 50, totalMs: 40_000 },
  deep: { target: 8, subQuestions: 5, perQuery: 6, pool: 16, perDomain: 50, totalMs: 40_000 },
};

let env: AuthEnv;
let web: MockServer;
let searx: MockServer;
let nine: MockServer;
let token: string;
let wsUrl: string;

/** Perilaku palsu yang diatur tiap tes. */
let llmOptions: ScriptedLlmOptions;
let llmHold: Promise<void> | undefined;
let searxStatus: number;
const llmCalls: { kind: string; user: string }[] = [];
const searched: string[] = [];

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });

async function startFakes() {
  web = await startMockServer((req, res) => {
    const n = Number(/artikel-(\d+)/.exec(req.url ?? '')?.[1]);
    if (req.url === '/lambat') return; // tidak pernah menjawab
    if (!Number.isFinite(n)) return void res.writeHead(404).end();
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(articleHtml(`Sumber ${n} tentang kendaraan listrik`, { published: '2026-01-15' }));
  });
  searx = await startMockServer((req, res) => {
    const q = new URL(req.url ?? '', 'http://x').searchParams.get('q') ?? '';
    searched.push(q);
    if (searxStatus !== 200) return void res.writeHead(searxStatus).end();
    const offset = ((searched.length - 1) * 6) % SITE_COUNT;
    const results = Array.from({ length: 8 }, (_, i) => {
      const n = ((offset + i) % SITE_COUNT) + 1;
      return {
        url: `${web.url}/artikel-${n}`,
        title: `Sumber ${n}`,
        content: 'cuplikan',
        engine: 'fake',
      };
    });
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ results }));
  });
  nine = await startMockServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const body = JSON.parse(await readBody(req)) as {
        model: string;
        messages: { role: string; content: string }[];
      };
      const request = {
        model: body.model,
        system: body.messages.find((m) => m.role === 'system')?.content,
        user: body.messages.findLast((m) => m.role === 'user')?.content ?? '',
      };
      llmCalls.push({ kind: classify(request), user: request.user });
      if (llmHold) await llmHold;
      if (res.destroyed) return;
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          choices: [
            { message: { role: 'assistant', content: scriptedLlmReply(request, llmOptions) } },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
      );
    })();
  });
}

beforeAll(async () => {
  await startFakes();
  env = await createAuthEnv(inject('testDatabaseUrl'), {
    ninerouterUrl: `${nine.url}/v1`,
    research: { searxngUrl: searx.url, depths: DEPTHS },
    schedules: { pollMs: 50 },
  });
  token = (await env.loginOk({ kind: 'desktop' })).accessToken;
  await env.app.listen({ port: 0, host: '127.0.0.1' });
  wsUrl = `ws://127.0.0.1:${(env.app.server.address() as AddressInfo).port}/v1/ws`;
}, 120_000);
afterAll(async () => {
  llmHold = undefined;
  await env.close();
  await Promise.all([web.close(), searx.close(), nine.close()]);
});
beforeEach(() => {
  llmOptions = {};
  llmHold = undefined;
  searxStatus = 200;
  llmCalls.length = 0;
  searched.length = 0;
});

const problem = (res: { json(): unknown }) => ProblemSchema.parse(res.json());
const db = () => env.database.handle.db;
const MISSING = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';

const create = async (
  question = 'Bagaimana perkembangan kendaraan listrik di Asia Tenggara?',
  depth?: string,
) => {
  const res = await env.post('/research', { question, ...(depth ? { depth } : {}) }, token);
  expect(res.statusCode, res.body).toBe(201);
  return ResearchJobSchema.parse(res.json());
};
const detail = async (id: string) =>
  ResearchJobDetailSchema.parse((await env.get(`/research/${id}`, token)).json());
const until = async <T>(read: () => Promise<T>, ok: (v: T) => boolean, ms = 30_000): Promise<T> => {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = await read();
    if (ok(v) || Date.now() > deadline) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
};
/** Menunggu status job DAN pelaksananya selesai total (notifikasi dan event penutup ikut terbit). */
const waitStatus = async (id: string, statuses: string[], ms?: number) => {
  const found = await until(
    () => detail(id),
    (d) => statuses.includes(d.status),
    ms,
  );
  await env.research.idle();
  return found;
};
const runEventsOf = async (runId: string): Promise<AgentEvent[]> =>
  (
    await db().select().from(runEvents).where(eq(runEvents.runId, runId)).orderBy(runEvents.seq)
  ).map((r) => r.payload);
/** Event penutup ditulis sesaat setelah baris job berubah; tunggu sampai event terakhir adalah status akhir. */
const settledEvents = async (runId: string, finalStatus: string) =>
  until(
    () => runEventsOf(runId),
    (events) => {
      const last = events.at(-1);
      return last?.type === 'run.status' && last.status === finalStatus;
    },
  );
const release = () => {
  let open!: () => void;
  llmHold = new Promise<void>((r) => (open = r));
  return () => {
    open();
    llmHold = undefined;
  };
};

describe('POST /research: satu pertanyaan sampai laporan bersitasi', () => {
  it('menjalankan seluruh pipeline: rencana, sumber, laporan dengan rujukan sah, event, dan notifikasi', async () => {
    const ws = await TestWs.connect(wsUrl, token);
    ws.send({ type: 'subscribe', channel: 'user' });
    await ws.until(() => ws.messages.length === 1, 3000, 'subscribed user');

    const job = await create('Bagaimana perkembangan kendaraan listrik di Asia Tenggara?', 'quick');
    expect(job).toMatchObject({ status: 'queued', depth: 'quick', plan: null, reportMd: null });
    expect(job.runId).not.toBeNull();
    const runChannel = `run:${job.runId}`;
    ws.send({ type: 'subscribe', channel: runChannel, lastSeq: 0 });

    const done = await waitStatus(job.id, ['completed', 'failed', 'cancelled']);
    expect(done.status).toBe('completed');

    /* Rencana dan sumber */
    expect(done.plan?.subQuestions).toHaveLength(3);
    expect(done.sources.length).toBeGreaterThanOrEqual(DEPTHS.quick.target);
    expect(done.sources.every((s) => s.fetchedAt !== null && s.url.startsWith(web.url))).toBe(true);
    expect(searched).toHaveLength(4); // 3 sub-pertanyaan + pertanyaan utama

    /* Laporan: struktur, rujukan sah, daftar sumber yang bisa diklik */
    const md = done.reportMd!;
    expect(md).toMatch(/^# /);
    expect(md.indexOf('## Ringkasan')).toBeLessThan(md.indexOf('## 1.'));
    for (const noise of [
      'JANGAN-MASUK-LAPORAN',
      'MENU-NAVIGASI',
      'IKLAN-SAMPING',
      'FOOTER-SITUS',
      '(tanpa rujukan)',
    ]) {
      expect(md, noise).not.toContain(noise);
    }
    const [body, list] = md.split('## Daftar sumber');
    const entries = [
      ...list!.matchAll(
        /^- \[(\d+)\] \[(.+?)\]\((http[^)]+)\) — (\S+), diakses (\d{4}-\d{2}-\d{2})$/gm,
      ),
    ];
    expect(entries.length).toBeGreaterThanOrEqual(2);
    expect(entries.map((e) => Number(e[1]))).toEqual(entries.map((_, i) => i + 1));
    // Setiap klaim penting punya rujukan sah, dan setiap URL di daftar adalah sumber yang benar-benar dibaca.
    expect(checkCitations(body!, entries.length)).toEqual({ invalid: [], uncited: [] });
    const readUrls = new Set(done.sources.map((s) => s.url));
    for (const e of entries) expect(readUrls.has(e[3]!), e[3]).toBe(true);
    // `used` hanya untuk sumber yang dikutip.
    expect(
      done.sources
        .filter((s) => s.used)
        .map((s) => s.url)
        .sort(),
    ).toEqual(entries.map((e) => e[3]!).sort());
    expect(done.sources.some((s) => !s.used) || done.sources.length === entries.length).toBe(true);

    /* Event: tahap, rencana, sumber, penutup */
    const events = await settledEvents(job.runId!, 'completed');
    const statuses = events
      .filter((e) => e.type === 'run.status')
      .map((e) => (e as { status: string }).status);
    expect(statuses).toEqual(['queued', 'routing', 'preparing', 'running', 'completed']);
    expect(events.find((e) => e.type === 'route.decided')).toMatchObject({ role: 'researcher' });
    const progress = events.flatMap((e) => (e.type === 'research.progress' ? [e] : []));
    expect([...new Set(progress.map((p) => p.stage))]).toEqual([
      'planning',
      'searching',
      'reading',
      'writing',
    ]);
    expect(progress.map((p) => p.progress)).toEqual(
      [...progress.map((p) => p.progress)].sort((a, b) => a - b),
    );
    expect(
      progress.find((p) => p.message?.startsWith('Rencana riset (3 sub-pertanyaan)'))?.message,
    ).toContain('1. Bagaimana aspek nomor 1');
    const sourceEvents = events.flatMap((e) => (e.type === 'research.source' ? [e] : []));
    expect(sourceEvents.map((s) => s.sourceId).sort()).toEqual(
      done.sources.map((s) => s.id).sort(),
    );
    expect(events.at(-2)?.type).toBe('run.completed');

    /* Run dan pemakaian token */
    const run = RunSchema.parse((await env.get(`/runs/${job.runId}`, token)).json());
    expect(run).toMatchObject({
      kind: 'research',
      engine: 'research',
      agentRole: 'researcher',
      status: 'completed',
    });
    await until(
      async () => (await db().select().from(runs).where(eq(runs.id, job.runId!)))[0]?.usage,
      (u) => u?.inputTokens === llmCalls.length * 10,
    );
    expect((await db().select().from(runs).where(eq(runs.id, job.runId!)))[0]?.usage).toMatchObject(
      {
        inputTokens: llmCalls.length * 10,
        outputTokens: llmCalls.length * 5,
      },
    );

    /* WebSocket: notifikasi di channel user, dan event run sama dengan yang tersimpan */
    await ws.until(() => ws.envelopes('user').length > 0, 5000, 'research.completed');
    expect(ws.envelopes('user')[0]!.event).toEqual({
      type: 'research.completed',
      researchId: job.id,
      runId: job.runId,
    });
    await ws.until(
      () =>
        ws
          .envelopes(runChannel)
          .some((e) => e.event.type === 'run.status' && e.event.status === 'completed'),
      5000,
      'event run',
    );
    const received: EventEnvelope[] = ws.envelopes(runChannel);
    expect(received.map((e) => e.event)).toEqual(events);
    ws.close();
  }, 90_000);

  it('GET /research (berhalaman, terbaru dulu) dan validasi masukan', async () => {
    const a = await create('Pertanyaan pertama untuk daftar riset');
    const b = await create('Pertanyaan kedua untuk daftar riset');
    const page1 = (await env.get('/research?limit=1', token)).json<{
      items: { id: string }[];
      nextBefore: string | null;
    }>();
    expect(page1.items.map((i) => i.id)).toEqual([b.id]);
    expect(page1.nextBefore).toBe(b.id);
    const page2 = (await env.get(`/research?limit=50&before=${b.id}`, token)).json<{
      items: { id: string }[];
    }>();
    expect(page2.items.map((i) => i.id)).toContain(a.id);
    expect(page2.items.map((i) => i.id)).not.toContain(b.id);

    expect(a.depth).toBe('standard'); // kedalaman bawaan
    for (const body of [
      {},
      { question: '' },
      { question: '   ' },
      { question: 'x', depth: 'sangat-dalam' },
      { question: 'x'.repeat(2001) },
    ]) {
      const res = await env.post('/research', body, token);
      expect(res.statusCode, JSON.stringify(body).slice(0, 40)).toBe(400);
    }
    await env.post(`/research/${a.id}/cancel`, {}, token);
    await env.post(`/research/${b.id}/cancel`, {}, token);
    await waitStatus(a.id, ['cancelled', 'completed', 'failed']);
    await waitStatus(b.id, ['cancelled', 'completed', 'failed']);
  }, 60_000);

  it('butuh login dan scope app di semua endpoint', async () => {
    const worker = (await env.loginOk({ kind: 'worker' })).accessToken;
    const calls: [string, string, object?][] = [
      ['POST', '/research', { question: 'x' }],
      ['GET', '/research'],
      ['GET', `/research/${MISSING}`],
      ['POST', `/research/${MISSING}/cancel`, {}],
      ['GET', `/research/${MISSING}/export?format=md`],
    ];
    for (const [method, path, payload] of calls) {
      for (const [auth, status] of [
        [undefined, 401],
        [worker, 403],
      ] as const) {
        const res = await env.app.inject({
          method: method as 'GET' | 'POST',
          url: `/v1${path}`,
          headers: auth ? { authorization: `Bearer ${auth}` } : {},
          ...(payload ? { payload } : {}),
        });
        expect(res.statusCode, `${method} ${path}`).toBe(status);
      }
    }
    expect((await env.get(`/research/${MISSING}`, token)).statusCode).toBe(404);
    expect((await env.post(`/research/${MISSING}/cancel`, {}, token)).statusCode).toBe(404);
  });
});

describe('GET /research/:id/export', () => {
  it('md dan pdf untuk riset selesai; 409 sebelum selesai; format salah 400', async () => {
    const release1 = release();
    const job = await create('Ekspor laporan kendaraan listrik regional', 'quick');
    await until(
      () => Promise.resolve(llmCalls.length),
      (n) => n > 0,
    );
    const early = await env.get(`/research/${job.id}/export?format=md`, token);
    expect([early.statusCode, problem(early).code]).toEqual([409, 'research_not_completed']);

    release1();
    const done = await waitStatus(job.id, ['completed', 'failed']);
    expect(done.status).toBe('completed');

    const md = await env.get(`/research/${job.id}/export?format=md`, token);
    expect(md.statusCode).toBe(200);
    expect(md.headers['content-type']).toBe('text/markdown; charset=utf-8');
    expect(md.headers['content-disposition']).toBe(
      'attachment; filename="riset-ekspor-laporan-kendaraan-listrik-regional.md"',
    );
    expect(md.body).toBe(done.reportMd);

    const pdf = await env.app.inject({
      method: 'GET',
      url: `/v1/research/${job.id}/export?format=pdf`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toContain(
      'riset-ekspor-laporan-kendaraan-listrik-regional.pdf',
    );
    expect(pdf.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.rawPayload.toString('latin1')).toContain(web.url.replace(/^http:\/\//, 'http://'));

    for (const q of ['', '?format=docx', '?format=']) {
      expect((await env.get(`/research/${job.id}/export${q}`, token)).statusCode, q).toBe(400);
    }
    expect((await env.get(`/research/${MISSING}/export?format=md`, token)).statusCode).toBe(404);
  }, 90_000);
});

describe('antrean, pembatalan, dan kegagalan', () => {
  it('cancel saat berjalan: berakhir cancelled tanpa error atau notifikasi selesai; antrean lanjut ke job berikutnya', async () => {
    const ws = await TestWs.connect(wsUrl, token);
    ws.send({ type: 'subscribe', channel: 'user' });
    await ws.until(() => ws.messages.length === 1, 3000, 'subscribed user');

    const open = release();
    const job = await create('Riset yang akan dibatalkan di tengah jalan', 'quick');
    await until(
      () => Promise.resolve(llmCalls.length),
      (n) => n > 0,
    );
    expect((await detail(job.id)).status).toBe('running');

    const res = await env.post(`/research/${job.id}/cancel`, {}, token);
    expect(res.statusCode, res.body).toBe(200);
    expect(ResearchJobSchema.parse(res.json()).status).toBe('cancelled');
    open();

    const events = await settledEvents(job.runId!, 'cancelled');
    expect(events.map((e) => e.type)).not.toContain('error');
    expect(events.map((e) => e.type)).not.toContain('run.completed');
    expect((await detail(job.id)).reportMd).toBeNull();
    expect(ws.envelopes('user')).toEqual([]);

    const again = await env.post(`/research/${job.id}/cancel`, {}, token);
    expect([again.statusCode, problem(again).code]).toEqual([409, 'research_not_active']);

    // Antrean tidak macet: job berikutnya selesai normal.
    const next = await create('Riset sesudah pembatalan berjalan normal', 'quick');
    expect((await waitStatus(next.id, ['completed', 'failed'])).status).toBe('completed');
    await ws.until(() => ws.envelopes('user').length === 1, 5000, 'notifikasi job berikutnya');
    ws.close();
  }, 90_000);

  it('satu job sekaligus: yang kedua antre, bisa dibatalkan sebelum berjalan dan tidak pernah memanggil model', async () => {
    const open = release();
    const first = await create('Job pertama menahan antrean riset', 'quick');
    await until(
      () => Promise.resolve(llmCalls.length),
      (n) => n > 0,
    );
    const second = await create('Job kedua menunggu giliran riset', 'quick');
    await new Promise((r) => setTimeout(r, 1500)); // lebih dari satu kali polling pg-boss
    expect((await detail(second.id)).status).toBe('queued');
    expect(llmCalls.some((c) => c.user.includes('Job kedua'))).toBe(false);

    const cancelled = await env.post(`/research/${second.id}/cancel`, {}, token);
    expect(ResearchJobSchema.parse(cancelled.json()).status).toBe('cancelled');
    expect(
      (await runEventsOf(second.runId!)).map((e) => (e.type === 'run.status' ? e.status : e.type)),
    ).toEqual(['queued', 'cancelled']);

    open();
    expect((await waitStatus(first.id, ['completed', 'failed'])).status).toBe('completed');
    await new Promise((r) => setTimeout(r, 1500));
    expect((await detail(second.id)).status).toBe('cancelled'); // tidak dijalankan sesudahnya
    expect(
      await db().select().from(researchSources).where(eq(researchSources.jobId, second.id)),
    ).toEqual([]);
  }, 90_000);

  it('SearXNG mati atau menolak format JSON: job failed dengan kode jelas, tanpa notifikasi selesai', async () => {
    searxStatus = 403;
    const job = await create('Riset ketika SearXNG menolak permintaan', 'quick');
    const done = await waitStatus(job.id, ['completed', 'failed']);
    expect(done.status).toBe('failed');
    const events = await settledEvents(job.runId!, 'failed');
    const error = events.find((e) => e.type === 'error');
    expect(error).toMatchObject({ code: 'search_empty', retryable: true });
    const run = RunSchema.parse((await env.get(`/runs/${job.runId}`, token)).json());
    expect(run).toMatchObject({ status: 'failed', error: { code: 'search_empty' } });
    expect(done.reportMd).toBeNull();
    expect((await env.get(`/research/${job.id}/export?format=md`, token)).statusCode).toBe(409);
  }, 60_000);

  it('perbaikan rujukan oleh model: laporan akhir tetap tidak punya klaim tanpa rujukan', async () => {
    llmOptions = { mode: 'uncited', repairFixes: true };
    const job = await create('Riset dengan laporan awal yang kurang rujukan', 'quick');
    const done = await waitStatus(job.id, ['completed', 'failed']);
    expect(done.status).toBe('completed');
    expect(llmCalls.filter((c) => c.kind === 'repair')).toHaveLength(1);
    expect(done.reportMd).not.toContain('(tanpa rujukan)');
  }, 60_000);

  it('klaim yang tetap tanpa rujukan ditandai terbuka dan disebut di ringkasan run', async () => {
    llmOptions = { mode: 'uncited', repairFixes: false };
    const job = await create('Riset dengan klaim yang tidak punya sumber', 'quick');
    const done = await waitStatus(job.id, ['completed', 'failed']);
    expect(done.reportMd).toContain('_(tanpa rujukan)_');
    const events = await settledEvents(job.runId!, 'completed');
    expect(events.find((e) => e.type === 'run.completed')).toMatchObject({
      summary: expect.stringContaining('klaim belum punya rujukan') as string,
    });
  }, 60_000);
});

describe('batas waktu dan pemulihan', () => {
  it('melewati batas total waktu tanpa sumber: failed research_timeout', async () => {
    const short = await createAuthEnv(inject('testDatabaseUrl'), {
      ninerouterUrl: `${nine.url}/v1`,
      research: { searxngUrl: searx.url, depths: { quick: { ...DEPTHS.quick, totalMs: 1500 } } },
    });
    try {
      const tok = (await short.loginOk({ kind: 'desktop' })).accessToken;
      const open = release(); // model tidak menjawab sampai batas waktu lewat
      const created = ResearchJobSchema.parse(
        (
          await short.post(
            '/research',
            { question: 'Riset yang melewati batas waktu total', depth: 'quick' },
            tok,
          )
        ).json(),
      );
      const done = await until(
        async () =>
          ResearchJobDetailSchema.parse((await short.get(`/research/${created.id}`, tok)).json()),
        (d) => d.status === 'failed',
        30_000,
      );
      open();
      expect(done.status).toBe('failed');
      await short.research.idle();
      const run = RunSchema.parse((await short.get(`/runs/${created.runId}`, tok)).json());
      expect(run.error).toMatchObject({ code: 'research_timeout', retryable: true });
    } finally {
      llmHold = undefined;
      await short.close();
    }
  }, 90_000);

  it('job yang tertinggal berstatus running saat gateway start ditandai gagal; yang selesai tidak disentuh', async () => {
    const [run] = await db()
      .insert(runs)
      .values({ kind: 'research', engine: 'research', agentRole: 'researcher', status: 'running' })
      .returning();
    const [orphan] = await db()
      .insert(researchJobs)
      .values({ question: 'Riset yang terputus oleh restart', status: 'running', runId: run!.id })
      .returning();
    const [finished] = await db()
      .insert(researchJobs)
      .values({ question: 'Riset yang sudah selesai', status: 'completed', reportMd: '# Selesai' })
      .returning();

    // Gateway 'baru': pg-boss sendiri, terpisah dari yang dipakai env tes.
    const bossRestart = new PgBoss({
      connectionString: env.database.url,
      schema: 'pgboss',
      max: 2,
    });
    await bossRestart.start();
    const restarted = createResearchService({
      db: db(),
      store: env.store,
      hub: env.hub,
      boss: bossRestart,
      llmFor: () => ({ chat: () => Promise.reject(new Error('tidak dipakai')) }),
      search: { search: () => Promise.reject(new Error('tidak dipakai')) },
      fetchPage: () => Promise.reject(new Error('tidak dipakai')),
      models: { main: 'research-main', summary: 'general-cheap' },
      roles: env.roles,
    });
    await restarted.start();
    await restarted.close();
    await bossRestart.stop({ graceful: false, timeout: 5000 });

    expect(
      (await db().select().from(researchJobs).where(eq(researchJobs.id, orphan!.id)))[0]?.status,
    ).toBe('failed');
    expect(
      (await db().select().from(researchJobs).where(eq(researchJobs.id, finished!.id)))[0],
    ).toMatchObject({
      status: 'completed',
      reportMd: '# Selesai',
    });
    const events = await runEventsOf(run!.id);
    expect(events.map((e) => (e.type === 'run.status' ? e.status : e.type))).toEqual([
      'error',
      'failed',
    ]);
    expect(events[0]).toMatchObject({ code: 'gateway_restarted', retryable: true });
  }, 60_000);
});

describe('jadwal dengan target research', () => {
  it('run-now menjalankan riset, laporan tersimpan sebagai pesan di percakapan jadwal, tanpa push ganda', async () => {
    const created = await env.post(
      '/schedules',
      {
        name: 'Riset mingguan',
        cron: '0 17 * * 5',
        prompt: 'Bagaimana perkembangan kendaraan listrik di Asia Tenggara?',
        target: 'research',
      },
      token,
    );
    expect(created.statusCode, created.body).toBe(201);
    const schedule = created.json<{ id: string; conversationId: string }>();

    const res = await env.post(`/schedules/${schedule.id}/run-now`, {}, token);
    expect(res.statusCode, res.body).toBe(201);
    const run = RunSchema.parse(res.json());
    expect(run.kind).toBe('research');

    await until(
      async () =>
        (await env.get(`/schedules/${schedule.id}/runs`, token)).json<{
          items: { status: string }[];
        }>().items[0]?.status,
      (s) => s !== 'running' && s !== undefined,
      60_000,
    );
    await env.schedules.idle();
    const history = (await env.get(`/schedules/${schedule.id}/runs`, token)).json<{
      items: { status: string; runId: string | null }[];
    }>().items;
    expect(history[0]).toMatchObject({ status: 'succeeded', runId: run.id });

    const stored = await db()
      .select()
      .from(messages)
      .where(eq(messages.conversationId, schedule.conversationId))
      .orderBy(messages.id);
    expect(stored.map((m) => [m.author, m.agentRole])).toEqual([
      ['user', null],
      ['assistant', 'researcher'],
    ]);
    expect(JSON.stringify(stored[1]!.parts)).toContain('Sumber');
    await env.del(`/schedules/${schedule.id}`, token);
  }, 90_000);
});
