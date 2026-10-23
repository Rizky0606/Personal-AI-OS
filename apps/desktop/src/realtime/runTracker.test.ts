import type { EventEnvelope, Run, ServerEvent } from '@aios/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newLiveRun, reduceLiveRun } from './liveRun';
import { RunTracker, RUN_POLL_MS } from './runTracker';

const RUN = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';
const MSG = '0192f0c4-7a1b-7c2d-9e3f-4a5b6c7d8e90';

describe('reduceLiveRun', () => {
  it('menyusun teks, role, dan langkah tool dari event', () => {
    const events: ServerEvent[] = [
      { type: 'run.status', status: 'running' },
      { type: 'route.decided', role: 'researcher', confidence: 0.9, reason: 'x' },
      { type: 'message.delta', messageId: MSG, text: 'Halo ' },
      { type: 'message.delta', messageId: MSG, text: 'dunia' },
      { type: 'tool.started', toolCallId: 't1', name: 'web.search', target: 'bun' },
      { type: 'tool.finished', toolCallId: 't1', status: 'ok', durationMs: 120 },
    ];
    const run = events.reduce(reduceLiveRun, newLiveRun(RUN));

    expect(run).toMatchObject({
      status: 'running',
      role: 'researcher',
      messageId: MSG,
      text: 'Halo dunia',
      tools: [{ id: 't1', name: 'web.search', status: 'ok', durationMs: 120 }],
    });
  });

  it('tool.started dengan id sama menggantikan langkah lama; sumber riset tidak ganda', () => {
    let run = newLiveRun(RUN);
    run = reduceLiveRun(run, { type: 'tool.started', toolCallId: 't1', name: 'a' });
    run = reduceLiveRun(run, { type: 'tool.started', toolCallId: 't1', name: 'b' });
    const source: ServerEvent = {
      type: 'research.source',
      sourceId: MSG,
      url: 'https://contoh.com/a',
      title: 'A',
    };
    run = reduceLiveRun(reduceLiveRun(run, source), source);

    expect(run.tools).toHaveLength(1);
    expect(run.tools[0]?.name).toBe('b');
    expect(run.sources).toHaveLength(1);
  });

  it('event yang tidak relevan mengembalikan objek yang sama', () => {
    const run = newLiveRun(RUN);
    expect(reduceLiveRun(run, { type: 'message.completed', messageId: MSG })).toBe(run);
  });

  it('error dan progres riset tercatat', () => {
    let run = newLiveRun(RUN);
    run = reduceLiveRun(run, { type: 'research.progress', stage: 'reading', progress: 0.5 });
    run = reduceLiveRun(run, { type: 'error', code: 'boom', message: 'Rusak', retryable: true });

    expect(run.research).toMatchObject({ stage: 'reading', progress: 0.5 });
    expect(run.error).toEqual({ code: 'boom', message: 'Rusak', retryable: true });
  });
});

describe('RunTracker', () => {
  let handler: ((envelope: EventEnvelope) => void) | undefined;
  const unsubscribe = vi.fn();
  const subscribe = vi.fn((_channel: string, h: (envelope: EventEnvelope) => void) => {
    handler = h;
    return unsubscribe;
  });
  const onFinished = vi.fn();
  const fetchRun = vi.fn<(id: string) => Promise<Run>>();

  const emit = (event: ServerEvent) =>
    handler?.({
      v: 1,
      channel: `run:${RUN}`,
      seq: 1,
      ts: '2026-10-22T06:38:00Z',
      event,
    });

  const make = () => new RunTracker({ realtime: { subscribe }, fetchRun, onFinished });

  beforeEach(() => {
    vi.useFakeTimers();
    handler = undefined;
    subscribe.mockClear();
    unsubscribe.mockClear();
    onFinished.mockClear();
    fetchRun.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it('melanggan run:<id> sekali walau track dipanggil berulang', () => {
    const tracker = make();
    tracker.track(RUN);
    tracker.track(RUN);

    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledWith(`run:${RUN}`, expect.any(Function));
  });

  it('memberi tahu pendengar saat event datang dan menyelesaikan run sekali', () => {
    const tracker = make();
    const listener = vi.fn();
    tracker.track(RUN);
    tracker.subscribe(RUN, listener);

    emit({ type: 'message.delta', messageId: MSG, text: 'Hai' });
    expect(tracker.get(RUN)?.text).toBe('Hai');
    expect(listener).toHaveBeenCalledTimes(1);

    emit({ type: 'run.status', status: 'completed' });
    emit({ type: 'run.status', status: 'completed' });

    expect(onFinished).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(tracker.get(RUN)?.status).toBe('completed');
  });

  it('polling menangkap status akhir bila event penutup tidak pernah sampai', async () => {
    fetchRun.mockResolvedValue({
      status: 'failed',
      error: { code: 'x', message: 'Gagal', retryable: false },
    } as Run);
    const tracker = make();
    tracker.track(RUN);

    await vi.advanceTimersByTimeAsync(RUN_POLL_MS);

    expect(tracker.get(RUN)).toMatchObject({
      status: 'failed',
      error: { code: 'x', message: 'Gagal' },
    });
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it('galat jaringan saat polling diabaikan dan dicoba lagi', async () => {
    fetchRun.mockRejectedValueOnce(new Error('putus'));
    fetchRun.mockResolvedValue({ status: 'completed', error: null } as Run);
    const tracker = make();
    tracker.track(RUN);

    await vi.advanceTimersByTimeAsync(RUN_POLL_MS * 2);

    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it('release membuang run dan menghentikan langganan', () => {
    const tracker = make();
    tracker.track(RUN);
    tracker.release(RUN);

    expect(tracker.get(RUN)).toBeUndefined();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
