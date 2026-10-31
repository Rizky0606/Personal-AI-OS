import { describe, expect, it } from 'vitest';
import type { ServerEvent } from '@aios/contracts';
import { newLiveRun, reduceLiveRun } from './liveRun';

describe('tool output display', () => {
  it('retains only the latest non-empty output line, bounded to one line', () => {
    let run = newLiveRun('output');
    run = reduceLiveRun(run, { type: 'tool.started', toolCallId: 't1', name: 'bash' }, 1);
    run = reduceLiveRun(
      run,
      { type: 'tool.output', toolCallId: 't1', chunk: 'first\nsecond\n' },
      2,
    );
    expect(run.tools[0]?.output).toBe('second');
    run = reduceLiveRun(run, { type: 'tool.output', toolCallId: 'unknown', chunk: 'ignored' }, 3);
    expect(run.tools).toHaveLength(1);
  });
});
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
  it('retains artifact.created metadata once for run activity', () => {
    const event = {
      type: 'artifact.created' as const,
      fileId: 'f1',
      name: 'screen.png',
      mime: 'image/png',
      size: 12,
      sha256: 'a'.repeat(64),
      source: 'screenshot' as const,
    };
    const run = reduceLiveRun(newLiveRun('artifact'), event, 1);
    expect(run.artifacts).toEqual([event]);
  });
});
