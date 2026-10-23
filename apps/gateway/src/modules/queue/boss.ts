import { PgBoss } from 'pg-boss';

/**
 * Satu instance pg-boss untuk seluruh gateway (riset dan jadwal). pg-boss membuat skema `pgboss` dan
 * migrasinya sendiri saat `start()`. Pemanggil yang memulai (`start`) juga yang menghentikan (`stop`).
 */
export function createBoss(
  connectionString: string,
  log?: { error: (obj: object, msg: string) => void },
): PgBoss {
  const boss = new PgBoss({
    connectionString,
    schema: 'pgboss',
    max: 4,
    application_name: 'aios-queue',
  });
  boss.on('error', (err) => log?.error({ err }, 'pg-boss error'));
  return boss;
}
