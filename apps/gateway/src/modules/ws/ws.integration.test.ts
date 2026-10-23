import {
  EventEnvelopeSchema,
  RunEventsResponseSchema,
  SendMessageResponseSchema,
  WS_CLOSE_UNAUTHORIZED,
  WS_MAX_CHANNELS,
  type AgentEvent,
  type EventEnvelope,
} from '@aios/contracts';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createAuthEnv, type AuthEnv } from '../../testing/auth-env.js';
import { startFakeHermes, type FakeHermes } from '../../testing/fake-hermes.js';
import { TestWs } from '../../testing/ws-client.js';

let env: AuthEnv;
let hermes: FakeHermes;
let token: string;
let url: string;

beforeAll(async () => {
  hermes = await startFakeHermes();
  env = await createAuthEnv(inject('testDatabaseUrl'), { hermesUrl: hermes.url });
  token = (await env.loginOk({ kind: 'desktop' })).accessToken;
  await env.app.listen({ port: 0, host: '127.0.0.1' });
  url = `ws://127.0.0.1:${(env.app.server.address() as AddressInfo).port}/v1/ws`;
});
afterAll(async () => {
  await env.close();
  await hermes.close();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const gate = () => {
  let open!: () => void;
  const promise = new Promise<void>((r) => (open = r));
  return { promise, open };
};

const startChat = async (text = 'halo') => {
  const conv = (await env.post('/conversations', { surface: 'windows' }, token)).json<{
    id: string;
  }>();
  const res = await env.post(
    `/conversations/${conv.id}/messages`,
    { parts: [{ type: 'text', text }] },
    token,
  );
  expect(res.statusCode, res.body).toBe(201);
  return { conversationId: conv.id, run: SendMessageResponseSchema.parse(res.json()).run };
};

const restEvents = async (runId: string) =>
  RunEventsResponseSchema.parse((await env.get(`/runs/${runId}/events?limit=500`, token)).json())
    .items;

const isFinal = (e: EventEnvelope) =>
  e.event.type === 'run.status' && ['completed', 'failed', 'cancelled'].includes(e.event.status);

const textOf = (envelopes: EventEnvelope[]) =>
  envelopes.map((e) => (e.event.type === 'message.delta' ? e.event.text : '')).join('');

describe('handshake', () => {
  it('tanpa token 401, token tidak punya scope app 403, token benar tersambung', async () => {
    expect(await TestWs.rejected(url, undefined)).toBe(401);
    expect(await TestWs.rejected(url, 'bukan.token.sah')).toBe(401);
    const worker = (await env.loginOk({ kind: 'worker' })).accessToken;
    expect(await TestWs.rejected(url, worker)).toBe(403);

    const ws = await TestWs.connect(url, token);
    ws.send({ type: 'ping' });
    await ws.until(() => ws.messages.some((m) => 'type' in m && m.type === 'pong'), 2000, 'pong');
    ws.close();
  });
});

describe('streaming dan replay', () => {
  it('pesan terkirim, jawaban mengalir ke WebSocket, envelope sesuai kontrak dan seq berurutan', async () => {
    hermes.onRequest(async (s) => {
      await sleep(50);
      s.reasoning('mikir');
      s.delta('Halo ');
      s.delta('dunia');
      s.finish();
      s.usage(7, 2);
      s.done();
    });
    const { run } = await startChat();
    const ws = await TestWs.connect(url, token);
    const channel = `run:${run.id}`;
    ws.send({ type: 'subscribe', channel, lastSeq: 0 });
    await ws.until(() => ws.envelopes(channel).some(isFinal), 5000, 'run selesai');

    expect(ws.messages[0]).toEqual(
      expect.objectContaining({ type: 'subscribed', channel, replay: true }),
    );
    const received = ws.envelopes(channel);
    for (const e of received) expect(EventEnvelopeSchema.safeParse(e).success).toBe(true);
    expect(received.map((e) => e.seq)).toEqual(received.map((_, i) => i + 1));
    expect(textOf(received)).toBe('Halo dunia');
    expect(received.map((e) => e.event.type)).toContain('reasoning.delta');
    // Sama persis dengan yang tersimpan di database.
    const stored = await restEvents(run.id);
    expect(received.map((e) => [e.seq, e.ts, e.event])).toEqual(
      stored.map((e) => [e.seq, e.ts, e.event]),
    );
    ws.close();
  });

  it('putus di tengah jawaban lalu sambung ulang dengan lastSeq: tidak ada event hilang atau ganda', async () => {
    const g1 = gate();
    const g2 = gate();
    hermes.onRequest(async (s) => {
      s.delta('a');
      await g1.promise;
      s.delta('b');
      s.delta('c');
      await g2.promise;
      s.delta('d');
      s.finish();
      s.done();
    });
    const { run } = await startChat();
    const channel = `run:${run.id}`;

    const first = await TestWs.connect(url, token);
    first.send({ type: 'subscribe', channel, lastSeq: 0 });
    await first.until(() => textOf(first.envelopes(channel)) === 'a', 5000, 'delta pertama');
    const before = first.envelopes(channel);
    const lastSeq = before.at(-1)!.seq;
    first.drop(); // jaringan putus
    await first.closed;

    g1.open(); // event 'b' dan 'c' terjadi saat klien offline
    for (let i = 0; i < 100 && (await restEvents(run.id)).length < lastSeq + 2; i++)
      await sleep(20);
    expect((await restEvents(run.id)).length).toBeGreaterThanOrEqual(lastSeq + 2);

    const second = await TestWs.connect(url, token);
    second.send({ type: 'subscribe', channel, lastSeq });
    await second.until(() => textOf(second.envelopes(channel)).startsWith('bc'), 5000, 'replay');
    g2.open(); // 'd' dan penutup tiba live
    await second.until(() => second.envelopes(channel).some(isFinal), 5000, 'run selesai');

    const all = [...before, ...second.envelopes(channel)];
    expect(all.map((e) => e.seq)).toEqual(all.map((_, i) => i + 1));
    expect(textOf(all)).toBe('abcd');
    expect(all.map((e) => e.event)).toEqual((await restEvents(run.id)).map((e) => e.event));
    second.close();
  });

  it('berlangganan di tengah stream yang deras: replay dan event live tersambung tanpa lubang atau ganda', async () => {
    const total = 150;
    hermes.onRequest(async (s) => {
      for (let i = 0; i < total; i++) {
        s.delta(`${i},`);
        if (i % 10 === 0) await sleep(1);
      }
      s.finish();
      s.done();
    });
    const { run } = await startChat();
    const channel = `run:${run.id}`;
    const ws = await TestWs.connect(url, token);
    await sleep(15);
    ws.send({ type: 'subscribe', channel, lastSeq: 0 });
    await ws.until(() => ws.envelopes(channel).some(isFinal), 10_000, 'run selesai');

    const got = ws.envelopes(channel);
    expect(got.map((e) => e.seq)).toEqual(got.map((_, i) => i + 1));
    expect(textOf(got)).toBe(Array.from({ length: total }, (_, i) => `${i},`).join(''));
    ws.close();
  });

  it('tanpa lastSeq hanya event baru (live); lastSeq melewati batas tidak memutar apa pun', async () => {
    const g = gate();
    hermes.onRequest(async (s) => {
      s.delta('lama');
      await g.promise;
      s.delta('baru');
      s.finish();
      s.done();
    });
    const { run } = await startChat();
    const channel = `run:${run.id}`;
    const ws = await TestWs.connect(url, token);
    // Pastikan 'lama' sudah tersimpan sebelum berlangganan, supaya ia benar-benar 'event lama'.
    for (
      let i = 0;
      i < 200 && !(await restEvents(run.id)).some((e) => e.event.type === 'message.delta');
      i++
    ) {
      await sleep(20);
    }
    ws.send({ type: 'subscribe', channel });
    await ws.until(() => ws.messages.length > 0, 2000, 'subscribed');
    g.open();
    await ws.until(() => ws.envelopes(channel).some(isFinal), 5000, 'run selesai');
    expect(textOf(ws.envelopes(channel))).toBe('baru');

    const beyond = await TestWs.connect(url, token);
    beyond.send({ type: 'subscribe', channel, lastSeq: 9999 });
    await sleep(150);
    expect(beyond.envelopes(channel)).toEqual([]);
    ws.close();
    beyond.close();
  });

  it('subscribe ulang ke channel yang sama memulai dari lastSeq baru; unsubscribe menghentikan kiriman', async () => {
    hermes.onRequest((s) => {
      s.delta('x');
      s.finish();
      s.done();
    });
    const { run } = await startChat();
    await env.runner.idle();
    const channel = `run:${run.id}`;
    const ws = await TestWs.connect(url, token);
    ws.send({ type: 'subscribe', channel, lastSeq: 0 });
    await ws.until(() => ws.envelopes(channel).some(isFinal), 3000, 'replay');
    const total = ws.envelopes(channel).length;

    ws.send({ type: 'subscribe', channel, lastSeq: total - 2 });
    await ws.until(() => ws.envelopes(channel).length === total + 2, 3000, 'replay ulang');
    expect(
      ws
        .envelopes(channel)
        .slice(total)
        .map((e) => e.seq),
    ).toEqual([total - 1, total]);

    ws.send({ type: 'unsubscribe', channel });
    ws.send({ type: 'ping' });
    await ws.until(
      () => ws.messages.filter((m) => 'type' in m && m.type === 'pong').length === 1,
      2000,
      'pong',
    );
    ws.close();
  });
});

describe('cancel lewat WebSocket', () => {
  it('klien melihat run.status cancelled sebagai event terakhir', async () => {
    hermes.onRequest((s) => {
      s.delta('mulai');
    });
    const { run } = await startChat();
    const channel = `run:${run.id}`;
    const ws = await TestWs.connect(url, token);
    ws.send({ type: 'subscribe', channel, lastSeq: 0 });
    await ws.until(() => textOf(ws.envelopes(channel)) === 'mulai', 5000, 'delta');
    expect((await env.post(`/runs/${run.id}/cancel`, {}, token)).statusCode).toBe(200);
    await ws.until(() => ws.envelopes(channel).some(isFinal), 5000, 'status akhir');
    expect(ws.envelopes(channel).at(-1)!.event).toEqual({
      type: 'run.status',
      status: 'cancelled',
    });
    ws.close();
  });
});

describe('channel', () => {
  it('channel conversation hanya live (replay=false) dan membawa status run percakapannya', async () => {
    hermes.onRequest(async (s) => {
      await sleep(80);
      s.delta('x');
      s.finish();
      s.done();
    });
    const conv = (await env.post('/conversations', { surface: 'windows' }, token)).json<{
      id: string;
    }>();
    const channel = `conversation:${conv.id}`;
    const ws = await TestWs.connect(url, token);
    ws.send({ type: 'subscribe', channel });
    await ws.until(() => ws.messages.length === 1, 2000, 'subscribed');
    expect(ws.messages[0]).toMatchObject({
      type: 'subscribed',
      channel,
      replay: false,
      lastSeq: 0,
    });

    await env.post(
      `/conversations/${conv.id}/messages`,
      { parts: [{ type: 'text', text: 'hai' }] },
      token,
    );
    await ws.until(
      () =>
        ws
          .envelopes(channel)
          .some((e) => e.event.type === 'run.status' && e.event.status === 'completed'),
      5000,
      'status completed',
    );
    const statuses = ws
      .envelopes(channel)
      .map((e) => (e.event as Extract<AgentEvent, { type: 'run.status' }>).status);
    expect(statuses).toEqual(['queued', 'routing', 'preparing', 'running', 'completed']);
    expect(ws.envelopes(channel).map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
    ws.close();
  });

  it('channel user bisa dilanggan; channel yang tidak ada, pesan rusak, dan binary mendapat error', async () => {
    const ws = await TestWs.connect(url, token);
    ws.send({ type: 'subscribe', channel: 'user' });
    ws.send({ type: 'subscribe', channel: 'run:0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f' });
    ws.send({ type: 'subscribe', channel: 'conversation:0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f' });
    ws.send({ type: 'subscribe', channel: 'room:1' });
    ws.send({ type: 'subscribe', channel: 'user', lastSeq: -1 });
    await ws.until(() => ws.messages.length === 5, 3000, 'jawaban');
    const codes = ws.messages.map((m) =>
      'type' in m ? (m.type === 'error' ? m.code : m.type) : 'event',
    );
    expect(codes).toEqual([
      'subscribed',
      'not_found',
      'not_found',
      'invalid_message',
      'invalid_message',
    ]);
    ws.close();
  });

  it(`maksimal ${WS_MAX_CHANNELS} channel per koneksi; berhenti berlangganan membebaskan slot`, async () => {
    const ids = await Promise.all(
      Array.from(
        { length: WS_MAX_CHANNELS + 1 },
        async () =>
          (await env.post('/conversations', { surface: 'android' }, token)).json<{ id: string }>()
            .id,
      ),
    );
    const ws = await TestWs.connect(url, token);
    for (const id of ids) ws.send({ type: 'subscribe', channel: `conversation:${id}` });
    await ws.until(() => ws.messages.length === WS_MAX_CHANNELS + 1, 5000, 'jawaban');
    expect(
      ws.messages.slice(0, WS_MAX_CHANNELS).every((m) => 'type' in m && m.type === 'subscribed'),
    ).toBe(true);
    expect(ws.messages.at(-1)).toMatchObject({
      type: 'error',
      code: 'too_many_channels',
      channel: `conversation:${ids.at(-1)}`,
    });

    ws.send({ type: 'unsubscribe', channel: `conversation:${ids[0]}` });
    ws.send({ type: 'subscribe', channel: `conversation:${ids.at(-1)}` });
    await ws.until(
      () => ws.messages.length === WS_MAX_CHANNELS + 2,
      3000,
      'subscribed setelah slot bebas',
    );
    expect(ws.messages.at(-1)).toMatchObject({ type: 'subscribed' });
    ws.close();
  });
});

describe('heartbeat dan sesi', () => {
  let hb: AuthEnv;
  let hbUrl: string;
  let hbToken: string;
  beforeAll(async () => {
    hb = await createAuthEnv(inject('testDatabaseUrl'), { heartbeatMs: 60 });
    hbToken = (await hb.loginOk({ kind: 'desktop' })).accessToken;
    await hb.app.listen({ port: 0, host: '127.0.0.1' });
    hbUrl = `ws://127.0.0.1:${(hb.app.server.address() as AddressInfo).port}/v1/ws`;
  });
  afterAll(async () => {
    await hb.close();
  });

  it('server mengirim ping berkala; klien yang membalas pong tetap tersambung', async () => {
    const ws = await TestWs.connect(hbUrl, hbToken);
    await ws.until(() => ws.pings.length >= 3, 20_000, 'tiga ping dari server');
    expect(ws.closeEvent).toBeUndefined();
    ws.close();
  });

  it('klien yang tidak membalas pong diputus server', async () => {
    const ws = await TestWs.connect(hbUrl, hbToken, { autoPong: false });
    await Promise.race([ws.closed, sleep(10_000)]);
    expect(ws.closeEvent).toBeDefined();
  });

  it('perangkat dicabut: koneksi ditutup dengan kode 4401 pada heartbeat berikutnya', async () => {
    const victim = await hb.loginOk({ kind: 'desktop', name: 'HP lama' });
    const ws = await TestWs.connect(hbUrl, victim.accessToken);
    expect((await hb.del(`/devices/${victim.device.id}`, hbToken)).statusCode).toBe(204);
    await Promise.race([ws.closed, sleep(10_000)]);
    expect(ws.closeEvent).toEqual({ code: WS_CLOSE_UNAUTHORIZED, reason: 'device_revoked' });
  });

  it('access token habis: koneksi ditutup 4401 token_expired agar klien refresh lalu sambung ulang', async () => {
    const fresh = await hb.loginOk({ kind: 'desktop', name: 'HP kedua' });
    const ws = await TestWs.connect(hbUrl, fresh.accessToken);
    hb.clock.now += 16 * 60_000;
    await Promise.race([ws.closed, sleep(10_000)]);
    expect(ws.closeEvent).toEqual({ code: WS_CLOSE_UNAUTHORIZED, reason: 'token_expired' });
  });
});
