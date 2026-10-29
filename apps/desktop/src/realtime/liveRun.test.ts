import type { EventEnvelope, Run, ServerEvent } from '@aios/contracts';
import { describe, expect, it, vi } from 'vitest';
import { isSettled, isTerminal, newLiveRun, reduceLiveRun, withRunStart } from './liveRun';
import { RunTracker } from './runTracker';

const RUN = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';
const A1 = '0192f0c4-7a1b-7c2d-a001-4a5b6c7d8e91';
const A2 = '0192f0c4-7a1b-7c2d-a002-4a5b6c7d8e92';

const requested = (approvalId: string, detail: string): ServerEvent => ({
  type: 'approval.requested',
  approvalId,
  kind: 'command',
  detail,
  cwd: 'C:\\work',
  toolCallId: 'c1',
});

describe('izin di LiveRun', () => {
  it('permintaan izin menunggu sampai diputuskan; yang lain tidak ikut terhapus', () => {
    let run = newLiveRun(RUN);
    run = reduceLiveRun(run, requested(A1, 'node --test'));
    run = reduceLiveRun(run, requested(A2, 'ls'));
    expect(run.approvals.map((a) => a.detail)).toEqual(['node --test', 'ls']);
    expect(run.approvals[0]).toEqual({
      approvalId: A1,
      kind: 'command',
      detail: 'node --test',
      cwd: 'C:\\work',
      toolCallId: 'c1',
    });

    run = reduceLiveRun(run, {
      type: 'approval.resolved',
      approvalId: A1,
      decision: 'allow',
      remember: false,
    });

    expect(run.approvals.map((a) => a.approvalId)).toEqual([A2]);
  });

  it('permintaan yang diputar ulang tidak menggandakan panel', () => {
    let run = newLiveRun(RUN);
    run = reduceLiveRun(run, requested(A1, 'node --test'));
    run = reduceLiveRun(run, requested(A1, 'node --test'));

    expect(run.approvals).toHaveLength(1);
  });
});

describe('isSettled', () => {
  it('status final dan needs_review selesai mengalir; yang lain belum', () => {
    for (const status of [
      'completed',
      'failed',
      'cancelled',
      'accepted',
      'rejected',
      'needs_review',
    ] as const) {
      expect(isSettled(status), status).toBe(true);
    }
    for (const status of [
      'queued',
      'routing',
      'preparing',
      'running',
      'waiting_approval',
    ] as const) {
      expect(isSettled(status), status).toBe(false);
    }
    // needs_review bukan status final di diagram, tetapi tidak ada lagi yang ditunggu dari mesin.
    expect(isTerminal('needs_review')).toBe(false);
  });

  it('RunTracker menyelesaikan run coding di needs_review (melepas langganan, memanggil onFinished sekali)', () => {
    let handler: ((e: EventEnvelope) => void) | undefined;
    const unsubscribe = vi.fn();
    const onFinished = vi.fn();
    const tracker = new RunTracker({
      realtime: {
        subscribe: (_c, h) => {
          handler = h;
          return unsubscribe;
        },
      },
      fetchRun: () => Promise.resolve({ status: 'running' } as Run),
      onFinished,
    });
    tracker.track(RUN);
    const emit = (event: ServerEvent) =>
      handler?.({
        v: 1,
        channel: `run:${RUN}`,
        seq: 1,
        ts: '2026-10-22T06:38:00Z',
        event,
      });

    emit({ type: 'run.status', status: 'running' });
    expect(onFinished).not.toHaveBeenCalled();
    emit({ type: 'run.status', status: 'needs_review' });
    emit({ type: 'run.status', status: 'needs_review' });

    expect(onFinished).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe('LiveRun: waktu, urutan tool, dan ringkasan penalaran', () => {
  const T0 = Date.parse('2026-10-29T10:00:00Z');
  const apply = (events: [ServerEvent, number | undefined][]) =>
    events.reduce((run, [event, ts]) => reduceLiveRun(run, event, ts), newLiveRun(RUN));
  const started = (id: string, name = 'bash', target?: string): ServerEvent => ({
    type: 'tool.started',
    toolCallId: id,
    name,
    ...(target ? { target } : {}),
  });
  const finished = (id: string, status: 'ok' | 'error' = 'ok', durationMs = 500): ServerEvent => ({
    type: 'tool.finished',
    toolCallId: id,
    status,
    durationMs,
  });

  it('startedAt = waktu event pertama yang terlihat; tidak bergeser oleh event berikutnya', () => {
    const run = apply([
      [{ type: 'run.status', status: 'running' }, T0],
      [{ type: 'message.delta', messageId: A1, text: 'x' }, T0 + 5000],
    ]);
    expect(run.startedAt).toBe(T0);
    expect(run.lastEventAt).toBe(T0 + 5000);
  });

  it('endedAt diisi sekali pada run.completed atau status selesai, dan tidak bergeser lagi', () => {
    const run = apply([
      [{ type: 'run.status', status: 'running' }, T0],
      [{ type: 'run.completed', summary: 's' }, T0 + 4000],
      [{ type: 'run.status', status: 'completed' }, T0 + 4100],
    ]);
    expect(run.endedAt).toBe(T0 + 4000);

    const reviewed = apply([
      [{ type: 'run.status', status: 'running' }, T0],
      [{ type: 'run.status', status: 'needs_review' }, T0 + 9000],
      [{ type: 'run.status', status: 'accepted' }, T0 + 99_000],
    ]);
    expect(reviewed.endedAt).toBe(T0 + 9000);
  });

  it('tanpa waktu (ts tidak diberikan) tidak ada waktu yang diisi', () => {
    const run = apply([[{ type: 'run.status', status: 'running' }, undefined]]);
    expect(run.startedAt).toBeNull();
    expect(run.lastEventAt).toBeNull();
  });

  it('withRunStart memakai waktu dibuat run dari server bila lebih awal dari event pertama', () => {
    const run = apply([[{ type: 'run.status', status: 'running' }, T0 + 3000]]);
    expect(withRunStart(run, T0).startedAt).toBe(T0);
    expect(withRunStart(run, T0 + 9000).startedAt).toBe(T0 + 3000);
    expect(withRunStart(newLiveRun(RUN), T0).startedAt).toBe(T0);
    expect(withRunStart(run, Number.NaN)).toBe(run);
  });

  it('tool.started menyimpan waktu mulai; event yang diputar ulang tidak memindahkan posisi atau waktu', () => {
    const run = apply([
      [started('a', 'bash', 'ls'), T0 + 1000],
      [started('b', 'read'), T0 + 2000],
      [started('a', 'bash', 'ls'), T0 + 9000],
    ]);
    expect(run.tools.map((t) => [t.id, t.startedAt])).toEqual([
      ['a', T0 + 1000],
      ['b', T0 + 2000],
    ]);
  });

  it('tool.finished yang datang sebelum tool.started tidak hilang; started menyusul melengkapi nama tanpa menghidupkan lagi', () => {
    const early = apply([[finished('a', 'error', 700), T0 + 3000]]);
    expect(early.tools).toEqual([
      { id: 'a', name: '', target: undefined, status: 'error', durationMs: 700, startedAt: null },
    ]);

    const merged = reduceLiveRun(early, started('a', 'bash', 'npm test'), T0 + 2000);
    expect(merged.tools).toEqual([
      {
        id: 'a',
        name: 'bash',
        target: 'npm test',
        status: 'error',
        durationMs: 700,
        startedAt: T0 + 2000,
      },
    ]);
  });

  it('aktivitas terakhir dilacak: penalaran, teks, tool', () => {
    let run = newLiveRun(RUN);
    expect(run.lastActivity).toBeNull();
    run = reduceLiveRun(run, { type: 'reasoning.delta', messageId: A1, text: 'mikir' });
    expect(run.lastActivity).toBe('reasoning');
    run = reduceLiveRun(run, started('a'));
    expect(run.lastActivity).toBe('tool');
    run = reduceLiveRun(run, { type: 'message.delta', messageId: A1, text: 'jawab' });
    expect(run.lastActivity).toBe('text');
  });

  it('reasoning.summary menggantikan judul sebelumnya (bukan menambah)', () => {
    let run = reduceLiveRun(newLiveRun(RUN), {
      type: 'reasoning.summary',
      messageId: A1,
      text: 'Membaca konfigurasi',
    });
    expect(run.reasoningSummary).toBe('Membaca konfigurasi');
    expect(run.messageId).toBe(A1);
    run = reduceLiveRun(run, { type: 'reasoning.summary', messageId: A1, text: 'Menulis tes' });
    expect(run.reasoningSummary).toBe('Menulis tes');
  });
});
