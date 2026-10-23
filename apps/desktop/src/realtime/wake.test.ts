import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watchWake } from './wake';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const setVisibility = (state: 'visible' | 'hidden') =>
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });

describe('watchWake', () => {
  it('jendela terlihat lagi memicu wake, tersembunyi tidak', () => {
    const onWake = vi.fn();
    const stop = watchWake(onWake);

    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(onWake).not.toHaveBeenCalled();

    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(onWake).toHaveBeenCalledWith('visible');
    stop();
  });

  it('jaringan kembali (event online) memicu wake', () => {
    const onWake = vi.fn();
    const stop = watchWake(onWake);
    window.dispatchEvent(new Event('online'));
    expect(onWake).toHaveBeenCalledWith('online');
    stop();
  });

  it('lompatan jam besar (PC tidur) memicu wake; detak normal tidak', () => {
    const onWake = vi.fn();
    const stop = watchWake(onWake, { intervalMs: 5_000, gapMs: 15_000 });

    vi.advanceTimersByTime(60_000);
    expect(onWake).not.toHaveBeenCalled();

    // Timer tidak berjalan saat tidur; jam dinding melompat satu jam.
    vi.setSystemTime(Date.now() + 60 * 60_000);
    vi.advanceTimersByTime(5_000);
    expect(onWake).toHaveBeenCalledWith('drift');
    stop();
  });

  it('fungsi berhenti melepas semua pendengar', () => {
    const onWake = vi.fn();
    const stop = watchWake(onWake);
    stop();
    window.dispatchEvent(new Event('online'));
    vi.setSystemTime(Date.now() + 60 * 60_000);
    vi.advanceTimersByTime(10_000);
    expect(onWake).not.toHaveBeenCalled();
  });
});
