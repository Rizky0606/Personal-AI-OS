import { describe, expect, it } from 'vitest';
import { newLiveRun, reduceLiveRun } from './liveRun';

describe('tool output display', () => {
  it('retains only the latest non-empty output line, bounded to one line', () => {
    let run = newLiveRun('output');
    run = reduceLiveRun(run, { type: 'tool.started', toolCallId: 't1', name: 'bash' }, 1);
    run = reduceLiveRun(run, { type: 'tool.output', toolCallId: 't1', chunk: 'first\nsecond\n' }, 2);
    expect(run.tools[0]?.output).toBe('second');
    run = reduceLiveRun(run, { type: 'tool.output', toolCallId: 'unknown', chunk: 'ignored' }, 3);
    expect(run.tools).toHaveLength(1);
  });
});
