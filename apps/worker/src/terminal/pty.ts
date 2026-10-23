import { killTree } from '../process/manager.js';

/** Satu proses di dalam pseudo-terminal. */
export interface PtyProcess {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

export interface PtySpawnOptions {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
  onData: (data: string) => void;
  onExit: (code: number) => void;
}

export type PtySpawn = (options: PtySpawnOptions) => PtyProcess;

/** Bagian API Bun yang dipakai; Bun tidak punya tipe di proyek ini karena kode juga berjalan di Node (tes). */
interface BunTerminal {
  write(data: string): number;
  resize(cols: number, rows: number): void;
}
interface BunSubprocess {
  pid: number;
  terminal?: BunTerminal;
  exited: Promise<number>;
  kill(): void;
}
interface BunRuntime {
  spawn(
    cmd: string[],
    options: {
      cwd: string;
      env: Record<string, string>;
      terminal: { cols: number; rows: number; data: (terminal: unknown, data: Uint8Array) => void };
    },
  ): BunSubprocess;
}

/** Bun menyediakan PTY sungguhan (ConPTY di Windows) tanpa modul native; null bila berjalan di Node. */
export function bunRuntime(): BunRuntime | null {
  const bun = (globalThis as { Bun?: BunRuntime }).Bun;
  return bun && typeof bun.spawn === 'function' ? bun : null;
}

/** PTY lewat `Bun.spawn({ terminal })`. Melempar bila dijalankan di luar Bun. */
export const spawnBunPty: PtySpawn = (options) => {
  const bun = bunRuntime();
  if (!bun) throw new Error('PTY hanya tersedia di worker hasil kompilasi Bun.');
  const decoder = new TextDecoder();
  const proc = bun.spawn([options.command, ...options.args], {
    cwd: options.cwd,
    env: options.env,
    terminal: {
      cols: options.cols,
      rows: options.rows,
      data: (_terminal, data) => options.onData(decoder.decode(data, { stream: true })),
    },
  });
  void proc.exited.then(
    (code) => options.onExit(code),
    () => options.onExit(-1),
  );
  return {
    write: (data) => void proc.terminal?.write(data),
    resize: (cols, rows) => proc.terminal?.resize(cols, rows),
    // Shell membawa turunan (conhost, perintah yang sedang jalan): matikan seluruh pohonnya.
    kill: () => killTree(proc.pid),
  };
};
