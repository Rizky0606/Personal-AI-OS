import { describe, expect, it } from 'vitest';
import { ompModelLimits } from './omp-path.js';

describe('ompModelLimits', () => {
  it('tanpa variabel: kosong (bawaan adapter berlaku)', () => {
    expect(ompModelLimits({})).toEqual({});
  });

  it('nilai valid dibaca', () => {
    expect(
      ompModelLimits({
        AIOS_OMP_REASONING: 'TRUE',
        AIOS_OMP_CONTEXT_WINDOW: '200000',
        AIOS_OMP_MAX_TOKENS: '32000',
      }),
    ).toEqual({ reasoning: true, contextWindow: 200000, maxTokens: 32000 });
    expect(ompModelLimits({ AIOS_OMP_REASONING: 'false' })).toEqual({ reasoning: false });
  });

  it('nilai tidak valid diabaikan dan dilaporkan', () => {
    const warnings: string[] = [];
    expect(
      ompModelLimits(
        { AIOS_OMP_REASONING: 'ya', AIOS_OMP_CONTEXT_WINDOW: '-1', AIOS_OMP_MAX_TOKENS: '8k' },
        (m) => warnings.push(m),
      ),
    ).toEqual({});
    expect(warnings).toHaveLength(3);
  });
});
