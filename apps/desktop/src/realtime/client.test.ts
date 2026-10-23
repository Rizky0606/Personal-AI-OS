import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RealtimeClient,
  defaultBackoffMs,
  wsUrlFor,
  type RealtimeDeps,
  type WsHandlers,
  type WsLink,
} from './client';

class FakeLink implements WsLink {
  readonly sent: string[] = [];
  closed = false;

  constructor(
    readonly url: string,
    readonly headers: Record<string, string>,
    readonly handlers: WsHandlers,
  ) {}

  send(text: string) {
    this.sent.push(text);
  }

  close() {
    this.closed = true;
  }

  /** Pesan yang dikirim klien bertipe tertentu. */
  frames(type: string): { channel?: string; lastSeq?: number }[] {
    return this.sent
      .map((s) => JSON.parse(s) as { type: string; channel?: string; lastSeq?: number })
      .filter((f) => f.type === type);
  }

  server(message: object) {
    this.handlers.onMessage(JSON.stringify(message));
  }
}

const TS = '2026-10-22T06:00:00.000Z';
const RUN = 'run:0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';
const USER = 'user';

const delta = (channel: string, seq: number, text: string) => ({
  v: 1,
  channel,
  seq,
  ts: TS,
  event: { type: 'message.delta', messageId: '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9a', text },
});

function setup(over: Partial<RealtimeDeps> = {}) {
  const links: FakeLink[] = [];
  const tokenCalls: string[] = [];
  const deps: RealtimeDeps = {
    open: (url, headers, handlers) => {
      const link = new FakeLink(url, headers, handlers);
      links.push(link);
      return Promise.resolve(link);
    },
    serverUrl: () => 'https://aios.contoh.com',
    token: () => Promise.resolve('tok-1'),
    refreshed: (stale) => {
      tokenCalls.push(stale);
      return Promise.resolve('tok-2');
    },
    ...over,
  };
  const client = new RealtimeClient(deps);
  const received: { channel: string; seq: number; text: string }[] = [];
  const listen = (channel: string) =>
    client.subscribe(channel, (e) => {
      if (e.event.type === 'message.delta')
        received.push({ channel: e.channel, seq: e.seq, text: e.event.text });
    });
  /** Membuka koneksi ke-n (handshake selesai). */
  const open = async (index = 0) => {
    await vi.advanceTimersByTimeAsync(0);
    links[index]!.handlers.onOpen();
  };
  return { client, links, tokenCalls, received, listen, open };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('RealtimeClient', () => {
  it('menyambung dengan header Authorization ke /v1/ws lalu berlangganan dengan lastSeq 0', async () => {
    const t = setup();
    t.listen(RUN);
    t.client.start();
    expect(t.client.getState()).toEqual({ kind: 'connecting' });
    await t.open();

    expect(t.links[0]!.url).toBe('wss://aios.contoh.com/v1/ws');
    expect(t.links[0]!.headers).toEqual({ authorization: 'Bearer tok-1' });
    expect(t.client.getState()).toEqual({ kind: 'connected' });
    expect(t.links[0]!.frames('subscribe')).toEqual([
      { type: 'subscribe', channel: RUN, lastSeq: 0 },
    ]);
  });

  it('onOpen yang datang sebelum open() mengembalikan tautan tetap berlangganan (urutan transport Tauri)', async () => {
    const links: FakeLink[] = [];
    const t = setup({
      open: (url, headers, handlers) => {
        const link = new FakeLink(url, headers, handlers);
        links.push(link);
        handlers.onOpen();
        return Promise.resolve(link);
      },
    });
    t.listen(RUN);
    t.client.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(t.client.getState()).toEqual({ kind: 'connected' });
    expect(links[0]!.frames('subscribe')).toHaveLength(1);
  });

  it('event diteruskan berurutan; seq yang sudah diterima di channel run tidak diproses dua kali', async () => {
    const t = setup();
    t.listen(RUN);
    t.client.start();
    await t.open();
    const link = t.links[0]!;

    link.server(delta(RUN, 1, 'Ha'));
    link.server(delta(RUN, 1, 'Ha'));
    link.server(delta(RUN, 2, 'lo'));
    link.server(delta(RUN, 2, 'lo'));

    expect(t.received.map((r) => r.text)).toEqual(['Ha', 'lo']);
  });

  it('frame rusak, tak dikenal, atau pong diabaikan tanpa memutus koneksi', async () => {
    const t = setup();
    t.listen(RUN);
    t.client.start();
    await t.open();
    const link = t.links[0]!;

    link.handlers.onMessage('bukan json');
    link.server({ type: 'pong' });
    link.server({ type: 'masa-depan' });
    link.server(delta(RUN, 1, 'ok'));

    expect(t.client.getState()).toEqual({ kind: 'connected' });
    expect(t.received.map((r) => r.text)).toEqual(['ok']);
  });

  it('putus lalu sambung ulang berlangganan dengan lastSeq terakhir, tanpa event hilang atau ganda', async () => {
    const t = setup();
    t.listen(RUN);
    t.client.start();
    await t.open();
    t.links[0]!.server(delta(RUN, 1, 'Ha'));
    t.links[0]!.server(delta(RUN, 2, 'lo'));

    t.links[0]!.handlers.onClose(null);
    expect(t.client.getState()).toEqual({ kind: 'reconnecting', attempt: 1 });
    expect(t.links).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(999);
    expect(t.links).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await t.open(1);

    expect(t.links[1]!.frames('subscribe')).toEqual([
      { type: 'subscribe', channel: RUN, lastSeq: 2 },
    ]);
    // Server memutar ulang dari awal: yang lama dibuang, hanya seq 3 yang baru.
    t.links[1]!.server(delta(RUN, 1, 'Ha'));
    t.links[1]!.server(delta(RUN, 2, 'lo'));
    t.links[1]!.server(delta(RUN, 3, ' dunia'));
    expect(t.received.map((r) => r.text)).toEqual(['Ha', 'lo', ' dunia']);
    expect(t.client.getState()).toEqual({ kind: 'connected' });
  });

  it('backoff 1, 2, 4, 8, 16 lalu tertahan 30 detik, dan reset setelah tersambung', async () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(defaultBackoffMs)).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000,
    ]);

    const t = setup();
    t.client.start();
    await vi.advanceTimersByTimeAsync(0);
    for (const wait of [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]) {
      const before = t.links.length;
      t.links[before - 1]!.handlers.onClose(null);
      await vi.advanceTimersByTimeAsync(wait - 1);
      expect(t.links.length, `belum boleh menyambung sebelum ${wait} ms`).toBe(before);
      await vi.advanceTimersByTimeAsync(1);
      expect(t.links.length, `harus menyambung tepat setelah ${wait} ms`).toBe(before + 1);
    }

    t.links.at(-1)!.handlers.onOpen();
    t.links.at(-1)!.handlers.onClose(null);
    const before = t.links.length;
    await vi.advanceTimersByTimeAsync(999);
    expect(t.links).toHaveLength(before);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.links).toHaveLength(before + 1);
  });

  it('gagal membuka soket (server mati) dicoba lagi dengan backoff', async () => {
    let attempts = 0;
    const t = setup({
      open: (url, headers, handlers) => {
        attempts++;
        if (attempts === 1) return Promise.reject(new Error('refused'));
        return Promise.resolve(new FakeLink(url, headers, handlers));
      },
    });
    t.client.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.client.getState()).toEqual({ kind: 'reconnecting', attempt: 1 });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(attempts).toBe(2);
  });

  it('close 4401 meminta token baru dan menyambung lagi tanpa jeda', async () => {
    const t = setup();
    t.client.start();
    await t.open();

    t.links[0]!.handlers.onClose(4401);
    await vi.advanceTimersByTimeAsync(0);

    expect(t.tokenCalls).toEqual(['tok-1']);
    expect(t.links).toHaveLength(2);
  });

  it('heartbeat: tanpa jawaban setelah ping, soket dianggap mati dan disambung ulang', async () => {
    const t = setup({ heartbeatMs: 20_000, pongTimeoutMs: 10_000 });
    t.client.start();
    await t.open();

    await vi.advanceTimersByTimeAsync(20_000);
    expect(t.links[0]!.frames('ping')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(t.links[0]!.closed).toBe(true);
    expect(t.links).toHaveLength(2);
  });

  it('heartbeat: jawaban pong menjaga koneksi', async () => {
    const t = setup({ heartbeatMs: 20_000, pongTimeoutMs: 10_000 });
    t.client.start();
    await t.open();

    await vi.advanceTimersByTimeAsync(20_000);
    t.links[0]!.server({ type: 'pong' });
    // Ping berikutnya baru pada detik ke-40; sampai detik ke-39 koneksi tidak boleh diputus.
    await vi.advanceTimersByTimeAsync(19_000);

    expect(t.links).toHaveLength(1);
    expect(t.client.getState()).toEqual({ kind: 'connected' });
  });

  it('probe setelah bangun dari tidur: tidak ada jawaban -> sambung ulang segera (< 10 detik)', async () => {
    const t = setup({ probeTimeoutMs: 4_000 });
    t.client.start();
    await t.open();

    t.client.probe();
    expect(t.links[0]!.frames('ping')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(4_000);

    expect(t.links).toHaveLength(2);
    t.links[1]!.handlers.onOpen();
    expect(t.client.getState()).toEqual({ kind: 'connected' });
  });

  it('probe: soket yang masih hidup menjawab dan tidak diputus', async () => {
    const t = setup({ probeTimeoutMs: 4_000 });
    t.client.start();
    await t.open();

    t.client.probe();
    t.links[0]!.server({ type: 'pong' });
    await vi.advanceTimersByTimeAsync(10_000);

    expect(t.links).toHaveLength(1);
  });

  it('reconnectNow (jaringan kembali) melewati sisa backoff', async () => {
    const t = setup();
    t.client.start();
    await t.open();
    t.links[0]!.handlers.onClose(null);
    t.links[0]!.handlers.onClose(null);
    expect(t.client.getState().kind).toBe('reconnecting');

    t.client.reconnectNow();
    await vi.advanceTimersByTimeAsync(0);

    expect(t.links).toHaveLength(2);
  });

  it('subscribe/unsubscribe saat terhubung mengirim frame langganan', async () => {
    const t = setup();
    t.client.start();
    await t.open();

    const off = t.listen(USER);
    expect(t.links[0]!.frames('subscribe')).toEqual([
      { type: 'subscribe', channel: USER, lastSeq: 0 },
    ]);
    off();
    expect(t.links[0]!.frames('unsubscribe')).toEqual([{ type: 'unsubscribe', channel: USER }]);
  });

  it('channel user tidak dededupe: seq boleh kembali ke awal setelah server restart', async () => {
    const t = setup();
    t.listen(USER);
    t.client.start();
    await t.open();
    t.links[0]!.server(delta(USER, 7, 'x'));
    t.links[0]!.handlers.onClose(null);
    await vi.advanceTimersByTimeAsync(1_000);
    await t.open(1);
    t.links[1]!.server(delta(USER, 1, 'y'));

    expect(t.received.map((r) => r.text)).toEqual(['x', 'y']);
  });

  it('tanpa sesi (token null) berhenti dan berstatus idle; stop() membersihkan', async () => {
    const t = setup({ token: () => Promise.resolve(null) });
    t.client.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.client.getState()).toEqual({ kind: 'idle' });
    expect(t.links).toHaveLength(0);

    const live = setup();
    live.client.start();
    await live.open();
    live.client.stop();
    expect(live.client.getState()).toEqual({ kind: 'idle' });
    expect(live.links[0]!.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(live.links).toHaveLength(1);
  });

  it('wsUrlFor: skema ws/wss dan path di belakang proxy', () => {
    expect(wsUrlFor('https://aios.contoh.com')).toBe('wss://aios.contoh.com/v1/ws');
    expect(wsUrlFor('http://localhost:3000')).toBe('ws://localhost:3000/v1/ws');
    expect(wsUrlFor('https://contoh.com/aios')).toBe('wss://contoh.com/aios/v1/ws');
  });
});
