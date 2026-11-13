import type { PgBoss } from 'pg-boss';
import type { SkillCurator } from './curator.js';
import type { ProposalService } from './proposal-service.js';

/**
 * Pekerjaan terjadwal skill (P11), memakai pg-boss yang sama dengan jadwal/riset/tim:
 * - kurator mingguan (Senin 03:00 UTC);
 * - pemantau skill baru buatan Hermes (tiap 15 menit; murni membaca folder, tanpa model).
 * Kegagalan satu putaran dicatat dan tidak menghentikan jadwal berikutnya.
 */
export const CURATOR_QUEUE = 'skills-curator';
export const HERMES_WATCH_QUEUE = 'skills-hermes-watch';
export const CURATOR_CRON = '0 3 * * 1';
export const HERMES_WATCH_CRON = '*/15 * * * *';

export async function startSkillJobs(deps: {
  boss: PgBoss;
  curator: SkillCurator;
  proposals: ProposalService;
  log?: { warn: (obj: object, msg: string) => void };
}): Promise<void> {
  const { boss, curator, proposals, log } = deps;
  for (const [queue, cron, key] of [
    [CURATOR_QUEUE, CURATOR_CRON, 'weekly'],
    [HERMES_WATCH_QUEUE, HERMES_WATCH_CRON, 'poll'],
  ] as const) {
    await boss.createQueue(queue, { policy: 'stately', retryLimit: 0, expireInSeconds: 3600 });
    await boss.schedule(queue, cron, {}, { tz: 'UTC', key, singletonKey: key });
  }
  await boss.work(
    CURATOR_QUEUE,
    { pollingIntervalSeconds: 30, batchSize: 1, localConcurrency: 1 },
    async () => {
      await curator.runOnce().catch((err: unknown) => log?.warn({ err }, 'kurator skill gagal'));
    },
  );
  await boss.work(
    HERMES_WATCH_QUEUE,
    { pollingIntervalSeconds: 30, batchSize: 1, localConcurrency: 1 },
    async () => {
      await proposals
        .watchHermes()
        .catch((err: unknown) => log?.warn({ err }, 'pemantau skill Hermes gagal'));
    },
  );
}
