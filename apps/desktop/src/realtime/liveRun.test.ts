import type { EventEnvelope, Run, ServerEvent } from '@aios/contracts';
import { describe, expect, it, vi } from 'vitest';
import { isSettled, isTerminal, newLiveRun, reduceLiveRun } from './liveRun';
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

describe('subagent di LiveRun', () => {
  const update = (id: string, status: 'running' | 'completed', toolCount: number): ServerEvent => ({
    type: 'subagent.updated',
    subagentId: id,
    agent: 'task',
    assignment: 'uji',
    status,
    toolCount,
    durationMs: 10,
    tokens: 1,
  });

  it('pembaruan menggantikan subagent yang sama; subagent baru ditambahkan menurut urutan kemunculan', () => {
    let run = newLiveRun(RUN);
    run = reduceLiveRun(run, update('A', 'running', 0));
    run = reduceLiveRun(run, update('B', 'running', 0));
    run = reduceLiveRun(run, update('A', 'completed', 3));

    expect(run.subagents.map((s) => [s.subagentId, s.status, s.toolCount])).toEqual([
      ['A', 'completed', 3],
      ['B', 'running', 0],
    ]);
    expect('type' in (run.subagents[0] ?? {})).toBe(false);
  });
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
