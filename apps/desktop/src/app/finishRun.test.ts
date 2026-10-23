import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newLiveRun } from '../realtime/liveRun';
import { finishRun } from './finishRun';

const RUN = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';

describe('finishRun', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('menyegarkan pesan, percakapan, dan riset dari server lalu melepas tampilan streaming', async () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const release = vi.fn();

    await finishRun(newLiveRun(RUN), { queryClient, release });

    const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
    expect(keys).toEqual(
      expect.arrayContaining([['messages'], ['conversations'], ['research'], ['researchJob']]),
    );
    expect(release).toHaveBeenCalledWith(RUN);
    // Pelepasan terjadi setelah penyegaran, bukan sebelumnya.
    expect(invalidate.mock.invocationCallOrder[0]).toBeLessThan(
      release.mock.invocationCallOrder[0]!,
    );
  });

  it('tetap melepas setelah mencoba 3 kali bila pengambilan terus gagal', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const query = queryClient.getQueryCache().build(queryClient, {
      queryKey: ['messages', 'c1'],
      queryFn: () => Promise.reject(new Error('offline')),
    });
    await query.fetch().catch(() => undefined);
    const release = vi.fn();

    const done = finishRun(newLiveRun(RUN), { queryClient, release });
    await vi.advanceTimersByTimeAsync(5_000);
    await done;

    expect(release).toHaveBeenCalledTimes(1);
  });
});
