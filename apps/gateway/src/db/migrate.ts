import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadConfig } from '../config.js';
import { createDb, type Database } from './client.js';

// src/db dan dist/db sama-sama dua tingkat di bawah akar paket, tempat folder drizzle/ berada.
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

export async function runMigrations(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}

// Dijalankan langsung: `node dist/db/migrate.js` atau `pnpm --filter @aios/gateway db:migrate`.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const handle = createDb(loadConfig().DATABASE_URL);
  runMigrations(handle.db)
    .then(() => {
      console.log('migrasi selesai');
      return handle.close();
    })
    .catch((err: unknown) => {
      console.error('migrasi gagal:', err instanceof Error ? err.message : 'kesalahan tak dikenal');
      process.exitCode = 1;
      return handle.close();
    });
}
