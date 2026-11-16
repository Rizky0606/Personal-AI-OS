import type { PgBoss } from 'pg-boss';
import { z } from 'zod';
import type { MemoryProposalService } from './proposal-service.js';

/**
 * Pekerjaan pg-boss `memory-extract` (docs/DESIGN_MEMORI_SEMANTIK.md 4.4). Satu pekerjaan per percakapan: kebijakan
 * `stately` dengan `singletonKey = conversationId` hanya mengizinkan satu yang mengantre, dan `startAfter` menunda
 * 45 detik, jadi beberapa giliran cepat di percakapan yang sama menjadi satu ekstraksi atas pesan-pesan terakhirnya.
 * Tanpa retry: ekstraksi yang gagal cukup dilewati (biaya model, bukan data yang hilang).
 */
export const MEMORY_EXTRACT_QUEUE = 'memory-extract';
export const MEMORY_EXTRACT_DELAY_SECONDS = 45;

const JobDataSchema = z.object({ conversationId: z.uuid() });

/** Fungsi `enqueue` untuk MemoryProposalService. */
export function memoryExtractEnqueue(
  boss: Pick<PgBoss, 'send'>,
  delaySeconds = MEMORY_EXTRACT_DELAY_SECONDS,
): (conversationId: string) => Promise<void> {
  return async (conversationId) => {
    await boss.send(
      MEMORY_EXTRACT_QUEUE,
      { conversationId },
      { singletonKey: conversationId, startAfter: delaySeconds },
    );
  };
}

export async function startMemoryExtractJobs(deps: {
  boss: PgBoss;
  proposals: Pick<MemoryProposalService, 'extract'>;
  pollingIntervalSeconds?: number;
  log?: { warn: (obj: object, msg: string) => void };
}): Promise<void> {
  const { boss, proposals, log } = deps;
  await boss.createQueue(MEMORY_EXTRACT_QUEUE, {
    policy: 'stately',
    retryLimit: 0,
    expireInSeconds: 300,
  });
  await boss.work(
    MEMORY_EXTRACT_QUEUE,
    { pollingIntervalSeconds: deps.pollingIntervalSeconds ?? 5, batchSize: 1, localConcurrency: 1 },
    async (jobs) => {
      for (const job of jobs) {
        const data = JobDataSchema.safeParse(job.data);
        if (!data.success) continue;
        await proposals
          .extract(data.data.conversationId)
          .catch((err: unknown) =>
            log?.warn({ err, conversationId: data.data.conversationId }, 'ekstraksi memori gagal'),
          );
      }
    },
  );
}
