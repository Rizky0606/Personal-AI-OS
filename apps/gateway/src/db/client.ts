import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

export type Database = NodePgDatabase<typeof schema>;

export interface DbHandle {
  db: Database;
  pool: pg.Pool;
  close: () => Promise<void>;
}

export interface DbOptions {
  max?: number;
  connectionTimeoutMillis?: number;
}

/**
 * Pool kecil: satu pemilik, satu VPS. Batas waktu koneksi dan query pendek supaya /readyz
 * dan request lain tidak menggantung ketika Postgres bermasalah.
 */
export function createDb(connectionString: string, options: DbOptions = {}): DbHandle {
  const pool = new pg.Pool({
    connectionString,
    max: options.max ?? 10,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 2000,
    idleTimeoutMillis: 30_000,
    query_timeout: 30_000,
  });
  // Tanpa listener ini, error pada koneksi idle akan mematikan proses.
  pool.on('error', () => undefined);
  return { db: drizzle(pool, { schema }), pool, close: () => pool.end() };
}
