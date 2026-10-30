import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useNow } from './useNow';

afterEach(() => vi.useRealTimers());

describe('useNow shared ticker', () => {
  it('publishes shared time at one-second boundaries and stops after last subscriber', () => {
    vi.useFakeTimers();
    const first = renderHook(() => useNow());
    const second = renderHook(() => useNow());
    const start = first.result.current;
    act(() => vi.advanceTimersByTime(1_000));
    expect(first.result.current).toBeGreaterThanOrEqual(start + 1_000);
    expect(second.result.current).toBe(first.result.current);
    first.unmount();
    second.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
