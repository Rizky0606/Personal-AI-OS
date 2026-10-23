import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    /** URL admin ke server Postgres; tiap tes membuat database sendiri di dalamnya. */
    testDatabaseUrl: string;
  }
}

const START_TIMEOUT_MS = 120_000;
const STOP_TIMEOUT_MS = 30_000;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

let embedded: { child: ChildProcess; databaseDir: string } | undefined;

/** Menjalankan Postgres tertanam di proses anak; selesai ketika anak mencetak READY. */
function startEmbedded(databaseDir: string, port: number): Promise<ChildProcess> {
  const script = fileURLToPath(new URL('./embedded-pg.mjs', import.meta.url));
  const child = spawn(process.execPath, [script, databaseDir, String(port)], {
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Postgres tertanam tidak siap dalam 120 detik.'));
    }, START_TIMEOUT_MS);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Postgres tertanam berhenti sebelum siap (kode ${String(code)}).`));
    });
    child.stdout.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('READY')) {
        clearTimeout(timer);
        child.removeAllListeners('exit');
        resolve(child);
      }
    });
  });
}

/**
 * Tes integrasi memakai Postgres nyata. Urutan:
 * 1. TEST_DATABASE_URL (CI memakai service postgres:16);
 * 2. Postgres tertanam (embedded-postgres 16) di direktori sementara, untuk mesin tanpa Docker.
 */
export async function setup(project: TestProject): Promise<void> {
  const external = process.env.TEST_DATABASE_URL;
  if (external) {
    project.provide('testDatabaseUrl', external);
    return;
  }
  if (process.env.CI) {
    // Tidak melempar di sini. URL kosong membuat setiap tes integrasi gagal di
    // createTestDatabase dengan pesan jelas, sementara tes unit tetap berjalan.
    project.provide('testDatabaseUrl', '');
    return;
  }

  const port = await freePort();
  const databaseDir = mkdtempSync(join(tmpdir(), 'aios-pg-'));
  try {
    embedded = { child: await startEmbedded(databaseDir, port), databaseDir };
  } catch (err) {
    rmSync(databaseDir, { recursive: true, force: true });
    throw err;
  }
  project.provide('testDatabaseUrl', `postgres://aios:aios-test@127.0.0.1:${port}/postgres`);
}

export async function teardown(): Promise<void> {
  if (!embedded) return;
  const { child, databaseDir } = embedded;
  embedded = undefined;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill();
      resolve();
    }, STOP_TIMEOUT_MS);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.stdin?.end();
  });
  rmSync(databaseDir, { recursive: true, force: true });
}
