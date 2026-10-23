import { homedir } from 'node:os';
import nodePath from 'node:path';
import { LOCAL_PROTOCOL_VERSION } from '@aios/contracts';
import { startWorker } from './worker.js';

/** Log ke stderr tanpa token, header, atau isi folder (SECURITY_OPS.md). */
const log = (message: string) => process.stderr.write(`[worker] ${message}\n`);

function dataDir(): string {
  const configured = process.env.AIOS_WORKER_DATA_DIR;
  if (configured) return configured;
  const base = process.env.LOCALAPPDATA ?? nodePath.join(homedir(), '.local', 'share');
  return nodePath.join(base, 'aios-worker');
}

async function main(): Promise<void> {
  const token = process.env.AIOS_WORKER_TOKEN ?? '';
  // Token dibuang dari lingkungan proses supaya tidak bocor ke proses anak.
  delete process.env.AIOS_WORKER_TOKEN;
  if (token.length < 16) {
    log('AIOS_WORKER_TOKEN wajib diisi (minimal 16 karakter).');
    process.exit(2);
  }

  const worker = await startWorker({ token, dataDir: dataDir(), log });
  // Satu baris JSON di stdout: dibaca Tauri untuk mengetahui port.
  process.stdout.write(
    `${JSON.stringify({ event: 'listening', port: worker.port, version: LOCAL_PROTOCOL_VERSION })}\n`,
  );

  let stopping = false;
  const shutdown = (reason: string) => {
    if (stopping) return;
    stopping = true;
    log(`berhenti: ${reason}`);
    const force = setTimeout(() => process.exit(0), 5000);
    force.unref();
    void worker.stop().finally(() => process.exit(0));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  // Aplikasi induk menutup pipe stdin saat keluar (juga bila crash): worker ikut berhenti, tidak yatim.
  process.stdin.on('end', () => shutdown('induk menutup stdin'));
  process.stdin.on('close', () => shutdown('induk menutup stdin'));
  process.stdin.resume();
}

main().catch((error: unknown) => {
  log(`gagal start: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
