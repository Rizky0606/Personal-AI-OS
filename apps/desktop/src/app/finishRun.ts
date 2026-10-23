import type { QueryClient } from '@tanstack/react-query';
import type { LiveRun } from '../realtime/liveRun';

const RETRIES = 3;
const RETRY_MS = 1_000;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface FinishDeps {
  queryClient: QueryClient;
  release: (runId: string) => void;
}

/**
 * Run selesai: ambil hasil akhir dari server (sumber kebenaran), baru lepas tampilan streaming. Bila
 * pengambilan gagal (jaringan), dicoba lagi sampai 3 kali supaya teks jawaban tidak hilang sebelum pesan
 * akhirnya terlihat. Setelah 3 kali gagal tampilan dilepas juga; pesan akhir muncul begitu koneksi pulih
 * dan daftar pesan diambil ulang.
 */
export async function finishRun(run: LiveRun, { queryClient, release }: FinishDeps): Promise<void> {
  const keys = [
    ['messages'],
    ['conversations'],
    ['run'],
    ['research'],
    ['researchJob'],
    ['schedules'],
  ];
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    const failed = queryClient
      .getQueryCache()
      .findAll({ queryKey: ['messages'], type: 'active' })
      .some((query) => query.state.status === 'error');
    if (!failed) break;
    if (attempt < RETRIES) await wait(RETRY_MS);
  }
  // Kegagalan run tidak hilang: RunTracker menyimpannya terpisah (failureOf) setelah release.
  release(run.runId);
}
