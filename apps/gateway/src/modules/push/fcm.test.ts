import { jwtVerify } from 'jose';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  FcmConfigError,
  channelFor,
  createFcmClient,
  loadServiceAccount,
  type ServiceAccount,
} from './fcm.js';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PRIVATE_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

interface Captured {
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
}

let server: Server;
let base: string;
let tokenRequests: Captured[];
let sendRequests: Captured[];
/** Balasan berikutnya untuk `messages:send`; kosong = 200. */
let sendReplies: { status: number; body?: unknown; headers?: Record<string, string> }[];
let tokenReply: { status: number; body: unknown };
let issuedTokens = 0;
const clock = { now: Date.UTC(2026, 9, 22, 6, 0, 0) };

const account = (): ServiceAccount => ({
  project_id: 'proyek-uji',
  client_email: 'fcm@proyek-uji.iam.gserviceaccount.com',
  private_key: PRIVATE_PEM,
  token_uri: `${base}/token`,
});

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const captured = {
        url: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      };
      res.setHeader('content-type', 'application/json');
      if (req.url === '/token') {
        tokenRequests.push(captured);
        if (tokenReply.status !== 200)
          return void res.writeHead(tokenReply.status).end(JSON.stringify(tokenReply.body));
        issuedTokens++;
        return void res
          .writeHead(200)
          .end(JSON.stringify({ access_token: `akses-${issuedTokens}`, expires_in: 3600 }));
      }
      sendRequests.push(captured);
      const reply = sendReplies.shift() ?? { status: 200, body: { name: 'projects/x/messages/1' } };
      res.writeHead(reply.status, reply.headers).end(JSON.stringify(reply.body ?? {}));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.closeAllConnections();
  server.close();
});
afterEach(() => undefined);

const reset = () => {
  tokenRequests = [];
  sendRequests = [];
  sendReplies = [];
  tokenReply = { status: 200, body: {} };
  issuedTokens = 0;
  clock.now = Date.UTC(2026, 9, 22, 6, 0, 0);
};

const message = {
  token: 'token-perangkat-rahasia',
  title: 'Ringkasan berita AI',
  data: { type: 'schedule.result', scheduleId: 'abc' },
};
const client = (extra: { fetch?: typeof fetch } = {}) =>
  createFcmClient({
    account: account(),
    baseUrl: base,
    retryDelayMs: 0,
    now: () => clock.now,
    ...extra,
  });

describe('FCM HTTP v1: permintaan', () => {
  it('mengambil token OAuth dengan JWT RS256 bertanda tangan service account, lalu mengirim ke endpoint proyek', async () => {
    reset();
    const result = await client().send(message);
    expect(result).toEqual({ ok: true });

    // Permintaan token: grant jwt-bearer, assertion bisa diverifikasi dengan kunci publik.
    const form = new URLSearchParams(tokenRequests[0]!.body);
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const { payload, protectedHeader } = await jwtVerify(form.get('assertion')!, publicKey, {
      currentDate: new Date(clock.now),
      audience: `${base}/token`,
      issuer: 'fcm@proyek-uji.iam.gserviceaccount.com',
    });
    expect(protectedHeader.alg).toBe('RS256');
    expect(payload.scope).toBe('https://www.googleapis.com/auth/firebase.messaging');
    expect(payload.sub).toBe('fcm@proyek-uji.iam.gserviceaccount.com');
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(3600);

    // Pengiriman: path proyek, Bearer dari token OAuth.
    expect(sendRequests[0]!.url).toBe('/v1/projects/proyek-uji/messages:send');
    expect(sendRequests[0]!.headers.authorization).toBe('Bearer akses-1');
  });

  it('payload hanya judul dan data ID (string); tidak ada body, isi, atau field lain', async () => {
    reset();
    await client().send(message);
    const sent = JSON.parse(sendRequests[0]!.body) as { message: Record<string, unknown> };
    expect(sent).toEqual({
      message: {
        token: 'token-perangkat-rahasia',
        notification: { title: 'Ringkasan berita AI' },
        data: { type: 'schedule.result', scheduleId: 'abc' },
        android: { priority: 'HIGH', notification: { channel_id: 'jadwal' } },
      },
    });
    expect((sent.message.notification as Record<string, unknown>).body).toBeUndefined();
    expect(
      Object.values(sent.message.data as Record<string, unknown>).every(
        (v) => typeof v === 'string',
      ),
    ).toBe(true);
  });

  it('token akses di-cache untuk banyak pengiriman (satu permintaan token), dan diperbarui mendekati kedaluwarsa', async () => {
    reset();
    const fcm = client();
    await Promise.all([fcm.send(message), fcm.send(message), fcm.send(message)]);
    await fcm.send(message);
    expect(tokenRequests).toHaveLength(1);
    expect(sendRequests).toHaveLength(4);

    clock.now += 3600_000 - 30_000; // tinggal 30 detik < batas 60 detik
    await fcm.send(message);
    expect(tokenRequests).toHaveLength(2);
    expect(sendRequests.at(-1)!.headers.authorization).toBe('Bearer akses-2');
  });
});

describe('FCM HTTP v1: hasil dan kegagalan', () => {
  it('token perangkat mati (UNREGISTERED / NOT_FOUND / 404): unregistered, tidak diulang', async () => {
    for (const body of [
      {
        error: {
          code: 404,
          status: 'NOT_FOUND',
          details: [
            {
              '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError',
              errorCode: 'UNREGISTERED',
            },
          ],
        },
      },
      { error: { code: 404, status: 'NOT_FOUND' } },
    ]) {
      reset();
      sendReplies = [{ status: 404, body }];
      expect(await client().send(message)).toEqual({
        ok: false,
        reason: 'unregistered',
        status: 404,
      });
      expect(sendRequests).toHaveLength(1);
    }
  });

  it('INVALID_ARGUMENT: invalid, tanpa coba ulang', async () => {
    reset();
    sendReplies = [{ status: 400, body: { error: { code: 400, status: 'INVALID_ARGUMENT' } } }];
    expect(await client().send(message)).toEqual({ ok: false, reason: 'invalid', status: 400 });
    expect(sendRequests).toHaveLength(1);
  });

  it('401: token OAuth diambil ulang sekali lalu pengiriman diulang dengan token baru', async () => {
    reset();
    sendReplies = [{ status: 401, body: { error: { status: 'UNAUTHENTICATED' } } }];
    expect(await client().send(message)).toEqual({ ok: true });
    expect(tokenRequests).toHaveLength(2);
    expect(sendRequests.map((r) => r.headers.authorization)).toEqual([
      'Bearer akses-1',
      'Bearer akses-2',
    ]);
  });

  it('401 terus-menerus: auth, bukan loop tak berujung', async () => {
    reset();
    sendReplies = [
      { status: 401, body: { error: { status: 'UNAUTHENTICATED' } } },
      { status: 401, body: { error: { status: 'UNAUTHENTICATED' } } },
    ];
    expect((await client().send(message)).ok).toBe(false);
    expect(sendRequests).toHaveLength(2);
  });

  it('SENDER_ID_MISMATCH dan 403: auth', async () => {
    for (const reply of [
      {
        status: 403,
        body: {
          error: { status: 'PERMISSION_DENIED', details: [{ errorCode: 'SENDER_ID_MISMATCH' }] },
        },
      },
      { status: 403, body: {} },
    ]) {
      reset();
      sendReplies = [reply];
      expect(await client().send(message)).toMatchObject({ ok: false, reason: 'auth' });
    }
  });

  it('429/503 dicoba ulang sampai berhasil; setelah 3 percobaan menjadi unavailable', async () => {
    reset();
    sendReplies = [
      { status: 503, body: {} },
      { status: 429, body: {} },
    ];
    expect(await client().send(message)).toEqual({ ok: true });
    expect(sendRequests).toHaveLength(3);

    reset();
    sendReplies = [
      { status: 500, body: {} },
      { status: 500, body: {} },
      { status: 500, body: {} },
    ];
    expect(await client().send(message)).toEqual({ ok: false, reason: 'unavailable', status: 500 });
    expect(sendRequests).toHaveLength(3);
  });

  it('jaringan putus: dicoba ulang lalu unavailable; token OAuth ditolak: auth tanpa kirim', async () => {
    reset();
    // Hanya pengiriman ke FCM yang putus; server token tetap normal.
    const broken = client({
      fetch: (url, init) =>
        (typeof url === 'string' ? url : url instanceof URL ? url.href : url.url).includes(
          'messages:send',
        )
          ? Promise.reject(new TypeError('fetch failed'))
          : fetch(url, init),
    });
    expect(await broken.send(message)).toEqual({ ok: false, reason: 'unavailable' });

    reset();
    tokenReply = { status: 400, body: { error: 'invalid_grant' } };
    expect(await client().send(message)).toEqual({ ok: false, reason: 'auth' });
    expect(sendRequests).toHaveLength(0);

    // Server token tidak terjangkau (bukan menolak): layak dicoba ulang, jadi unavailable.
    reset();
    const offline = client({ fetch: () => Promise.reject(new TypeError('fetch failed')) });
    expect(await offline.send(message)).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('kunci privat yang rusak: auth, tanpa melempar dan tanpa membocorkan kunci ke log', async () => {
    reset();
    const warnings: string[] = [];
    const fcm = createFcmClient({
      account: { ...account(), private_key: 'bukan-pem-yang-sah' },
      baseUrl: base,
      log: { warn: (obj, msg) => warnings.push(JSON.stringify(obj) + msg) },
    });
    expect(await fcm.send(message)).toEqual({ ok: false, reason: 'auth' });
    expect(warnings.join('')).not.toContain('bukan-pem-yang-sah');
  });
});

describe('kanal notifikasi Android', () => {
  it('jenis event dipetakan ke kanal; selain itu umum', () => {
    expect(channelFor('research.completed')).toBe('riset');
    expect(channelFor('schedule.result')).toBe('jadwal');
    expect(channelFor('test')).toBe('umum');
    expect(channelFor(undefined)).toBe('umum');
  });

  it('kanal ikut di payload tanpa menambah isi notifikasi', async () => {
    reset();
    await client().send({
      token: 't',
      title: 'Riset selesai: x',
      data: { type: 'research.completed', researchId: 'r' },
    });
    const sent = JSON.parse(sendRequests[0]!.body) as {
      message: { android: unknown; notification: unknown };
    };
    expect(sent.message.android).toEqual({
      priority: 'HIGH',
      notification: { channel_id: 'riset' },
    });
    expect(sent.message.notification).toEqual({ title: 'Riset selesai: x' });
  });
});

describe('memuat service account', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aios-fcm-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('membaca file yang lengkap dan memberi token_uri bawaan Google', () => {
    const file = join(dir, 'ok.json');
    writeFileSync(
      file,
      JSON.stringify({
        project_id: 'p',
        client_email: 'a@b.c',
        private_key: PRIVATE_PEM,
        type: 'service_account',
      }),
    );
    const loaded = loadServiceAccount(file);
    expect(loaded.project_id).toBe('p');
    expect(loaded.token_uri).toBe('https://oauth2.googleapis.com/token');
  });

  it('file hilang, bukan JSON, atau tidak lengkap: FcmConfigError yang tidak memuat isi file', () => {
    const secret = 'SANGAT-RAHASIA-PRIVATE-KEY';
    const broken = join(dir, 'rusak.json');
    writeFileSync(broken, `{ ${secret}`);
    const partial = join(dir, 'sebagian.json');
    writeFileSync(partial, JSON.stringify({ project_id: 'p', private_key: secret }));
    for (const file of [join(dir, 'tidak-ada.json'), broken, partial]) {
      let error: unknown;
      try {
        loadServiceAccount(file);
      } catch (err) {
        error = err;
      }
      expect(error).toBeInstanceOf(FcmConfigError);
      expect((error as Error).message).not.toContain(secret);
    }
  });
});
