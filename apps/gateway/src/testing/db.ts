import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { createDb, type DbHandle } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';

export interface TestDatabase {
  url: string;
  handle: DbHandle;
  drop(): Promise<void>;
}

/** Membuat database baru yang terisolasi (dengan migrasi) di server tes, lalu menghapusnya setelah selesai. */
export async function createTestDatabase(adminUrl: string, migrate = true): Promise<TestDatabase> {
  if (!adminUrl) {
    throw new Error('TEST_DATABASE_URL wajib diisi di CI; tes integrasi tidak boleh dilewati.');
  }
  const name = `aios_test_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`create database ${name}`);
  } finally {
    await admin.end();
  }

  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  // Tes berjalan paralel di satu server Postgres tertanam; di Windows tiap koneksi adalah proses baru, jadi
  // pool dikecilkan dan batas koneksi dilonggarkan agar mesin yang sibuk tidak menghasilkan kegagalan acak.
  const handle = createDb(url.toString(), { max: 4, connectionTimeoutMillis: 30_000 });
  if (migrate) await runMigrations(handle.db);

  return {
    url: url.toString(),
    handle,
    async drop() {
      await handle.close();
      const cleanup = new pg.Client({ connectionString: adminUrl });
      await cleanup.connect();
      try {
        await cleanup.query(`drop database if exists ${name} with (force)`);
      } finally {
        await cleanup.end();
      }
    },
  };
}
