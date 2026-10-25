import { describe, expect, it, vi } from 'vitest';
import { newLiveRun, type LiveRun } from '../realtime/liveRun';
import { startQuickBridge, type QuickHost } from './bridge';
import { QUICK_SHORTCUT, QuickEvent, type QuickUpdate } from './protocol';

const CONV = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';
const RUN = '0192f0c4-7a1b-7c2d-9e3f-4a5b6c7d8e90';

function fakeHost() {
  const handlers = new Map<string, (payload: unknown) => void>();
  const updates: QuickUpdate[] = [];
  let shortcut: (() => void) | null = null;
  const spies = {
    registerShortcut: vi.fn((_s: string, onPress: () => void) => {
      shortcut = onPress;
      return Promise.resolve(() => (shortcut = null));
    }),
    toggleQuick: vi.fn(() => Promise.resolve()),
    hideQuick: vi.fn(() => Promise.resolve()),
    showMain: vi.fn(() => Promise.resolve()),
  };
  const host: QuickHost = {
    listen: <T>(event: string, handler: (payload: T) => void) => {
      handlers.set(event, handler as (payload: unknown) => void);
      return Promise.resolve(() => handlers.delete(event));
    },
    emitToQuick: (_event, payload) => {
      updates.push(payload as QuickUpdate);
      return Promise.resolve();
    },
    ...spies,
  };
  return {
    host,
    spies,
    updates,
    fire: (event: string, payload: unknown) => handlers.get(event)?.(payload),
    press: () => shortcut?.(),
    hasListeners: () => handlers.size > 0,
  };
}

function fakeRuns() {
  const live = new Map<string, LiveRun>();
  const listeners = new Map<string, () => void>();
  return {
    runs: {
      track: vi.fn((id: string) => void live.set(id, newLiveRun(id))),
      get: (id: string) => live.get(id),
      subscribe: (id: string, listener: () => void) => {
        listeners.set(id, listener);
        return () => listeners.delete(id);
      },
    },
    emit(id: string, change: Partial<LiveRun>) {
      live.set(id, { ...live.get(id)!, ...change });
      listeners.get(id)?.();
    },
    listening: (id: string) => listeners.has(id),
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('startQuickBridge', () => {
  it('pertanyaan membuat percakapan baru, jawaban diteruskan bertahap sampai selesai', async () => {
    const h = fakeHost();
    const r = fakeRuns();
    const api = {
      createConversation: vi.fn(() => Promise.resolve({ id: CONV })),
      sendMessage: vi.fn(() => Promise.resolve({ run: { id: RUN } })),
    };
    await startQuickBridge({
      host: h.host,
      api,
      runs: r.runs,
      openConversation: vi.fn(),
      errorMessage: () => 'galat',
    });

    h.fire(QuickEvent.ask, { id: 'q1', text: '  Apa itu closure?  ' });
    await flush();
    expect(api.sendMessage).toHaveBeenCalledWith(CONV, { text: 'Apa itu closure?' });
    expect(r.runs.track).toHaveBeenCalledWith(RUN);

    r.emit(RUN, { status: 'running', text: 'Closure adalah' });
    r.emit(RUN, { status: 'completed', text: 'Closure adalah fungsi.' });

    expect(h.updates.map((u) => [u.status, u.text])).toEqual([
      ['sending', ''],
      ['streaming', ''],
      ['streaming', 'Closure adalah'],
      ['done', 'Closure adalah fungsi.'],
    ]);
    expect(h.updates.at(-1)).toMatchObject({ id: 'q1', conversationId: CONV });
    expect(r.listening(RUN)).toBe(false);
  });

  it('run gagal dan galat API dikirim sebagai status error', async () => {
    const h = fakeHost();
    const r = fakeRuns();
    let fail = false;
    await startQuickBridge({
      host: h.host,
      api: {
        createConversation: () =>
          fail ? Promise.reject(new Error('x')) : Promise.resolve({ id: CONV }),
        sendMessage: () => Promise.resolve({ run: { id: RUN } }),
      },
      runs: r.runs,
      openConversation: vi.fn(),
      errorMessage: () => 'Server tidak terjangkau.',
    });

    h.fire(QuickEvent.ask, { id: 'q1', text: 'Halo' });
    await flush();
    r.emit(RUN, {
      status: 'failed',
      error: { code: 'x', message: 'Model sibuk.', retryable: true },
    });
    expect(h.updates.at(-1)).toMatchObject({ status: 'error', error: 'Model sibuk.' });

    fail = true;
    h.fire(QuickEvent.ask, { id: 'q2', text: 'Lagi' });
    await flush();
    expect(h.updates.at(-1)).toMatchObject({
      id: 'q2',
      status: 'error',
      error: 'Server tidak terjangkau.',
    });
  });

  it('hotkey menampilkan/menyembunyikan jendela; Lanjutkan di chat membuka percakapan di jendela utama', async () => {
    const h = fakeHost();
    const openConversation = vi.fn();
    const stop = await startQuickBridge({
      host: h.host,
      api: { createConversation: vi.fn(), sendMessage: vi.fn() },
      runs: fakeRuns().runs,
      openConversation,
      errorMessage: () => '',
    });
    expect(h.spies.registerShortcut).toHaveBeenCalledWith(QUICK_SHORTCUT, expect.any(Function));
    h.press();
    expect(h.spies.toggleQuick).toHaveBeenCalled();

    h.fire(QuickEvent.open, { conversationId: CONV });
    expect(openConversation).toHaveBeenCalledWith(CONV);
    expect(h.spies.showMain).toHaveBeenCalled();
    expect(h.spies.hideQuick).toHaveBeenCalled();

    stop();
    expect(h.hasListeners()).toBe(false);
  });

  it('hotkey bentrok dengan aplikasi lain: jembatan tetap hidup tanpa melempar', async () => {
    const h = fakeHost();
    h.host.registerShortcut = () => Promise.reject(new Error('sudah dipakai'));
    const log = vi.fn();
    await expect(
      startQuickBridge({
        host: h.host,
        api: { createConversation: vi.fn(), sendMessage: vi.fn() },
        runs: fakeRuns().runs,
        openConversation: vi.fn(),
        errorMessage: () => '',
        log,
      }),
    ).resolves.toBeTypeOf('function');
    expect(log).toHaveBeenCalledWith('Quick Ask tidak aktif', expect.any(Error));
  });
});
