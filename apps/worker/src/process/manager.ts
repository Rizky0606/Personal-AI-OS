import { spawn, type ChildProcess } from 'node:child_process';

export interface RunOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  /** Dimatikan (beserta anak-anaknya) bila lewat; default dari manajer. */
  timeoutMs?: number;
  /** Mengelompokkan proses per run supaya bisa dimatikan sekaligus saat run selesai. */
  runId?: string;
  /** Keluaran melebihi ini dipotong (bukan membuat memori membengkak). */
  maxOutputBytes?: number;
  input?: string;
}

export interface ProcessResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
  /** Gagal dijalankan (mis. program tidak ada). */
  spawnError?: string;
}

export interface ProcessManagerOptions {
  /** Proses anak yang boleh berjalan bersamaan; sisanya antre. */
  maxConcurrent?: number;
  defaultTimeoutMs?: number;
  /**
   * Memeriksa dan menormalkan `cwd` sebelum proses dimulai. Di worker: hanya folder yang diizinkan.
   * Melempar untuk menolak.
   */
  checkCwd?: (cwd: string) => Promise<string>;
}

interface Tracked {
  child: ChildProcess;
  runId: string | undefined;
}

const DEFAULT_MAX_OUTPUT = 1024 * 1024;

/** Mematikan proses dan seluruh turunannya. Windows: taskkill /T; POSIX: grup proses. */
export function killTree(pid: number | undefined): void {
  if (pid === undefined) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    killer.on('error', () => undefined);
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Sudah mati.
    }
  }
}

/**
 * Pengelola proses anak: melacak, membatasi jumlah bersamaan, menerapkan batas waktu, dan mematikan
 * semuanya saat run selesai atau aplikasi keluar (SECURITY_OPS.md). Tanpa shell: perintah dan argumen
 * dipisah, jadi tidak ada injeksi lewat string perintah.
 */
export class ProcessManager {
  private readonly active = new Set<Tracked>();
  private readonly waiting: (() => void)[] = [];
  private readonly maxConcurrent: number;
  private readonly defaultTimeoutMs: number;
  private shuttingDown = false;

  constructor(private readonly options: ProcessManagerOptions = {}) {
    this.maxConcurrent = options.maxConcurrent ?? 8;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 60_000;
  }

  /** Jumlah proses yang sedang berjalan. */
  get running(): number {
    return this.active.size;
  }

  /** Run yang masih punya proses. */
  activeRunIds(): string[] {
    return [...new Set([...this.active].flatMap((t) => (t.runId ? [t.runId] : [])))];
  }

  async run(command: string, args: string[], options: RunOptions): Promise<ProcessResult> {
    if (!command || /[\0\r\n]/.test(command)) {
      return emptyResult({ spawnError: 'Perintah tidak valid.' });
    }
    let cwd = options.cwd;
    if (this.options.checkCwd) cwd = await this.options.checkCwd(cwd);
    await this.acquire();
    if (this.shuttingDown) {
      this.release();
      return emptyResult({ spawnError: 'Worker sedang berhenti.' });
    }
    try {
      return await this.execute(command, args, { ...options, cwd });
    } finally {
      this.release();
    }
  }

  /** Mematikan semua proses milik satu run. */
  async killRun(runId: string): Promise<void> {
    const targets = [...this.active].filter((t) => t.runId === runId);
    for (const t of targets) killTree(t.child.pid);
    await Promise.all(targets.map((t) => exited(t.child)));
  }

  /** Mematikan semuanya dan menolak yang baru (dipanggil saat worker berhenti). */
  async killAll(): Promise<void> {
    this.shuttingDown = true;
    this.waiting.splice(0).forEach((resume) => resume());
    const targets = [...this.active];
    for (const t of targets) killTree(t.child.pid);
    await Promise.all(targets.map((t) => exited(t.child)));
  }

  /** Slot terpakai (termasuk yang sedang dimulai). Saat dilepas, slot langsung diserahkan ke antrean. */
  private slots = 0;

  private acquire(): Promise<void> {
    if (this.slots < this.maxConcurrent) {
      this.slots++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.slots--;
  }

  private execute(command: string, args: string[], options: RunOptions): Promise<ProcessResult> {
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const maxBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;
    return new Promise((resolve) => {
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env ?? process.env,
        shell: false,
        windowsHide: true,
        // POSIX: grup proses sendiri supaya killTree bisa mematikan seluruh turunan.
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const tracked: Tracked = { child, runId: options.runId };
      this.active.add(tracked);

      let stdout = '';
      let stderr = '';
      let bytes = 0;
      let truncated = false;
      let timedOut = false;
      let spawnError: string | undefined;

      const collect = (target: 'out' | 'err') => (chunk: Buffer) => {
        if (bytes >= maxBytes) {
          truncated = true;
          return;
        }
        const room = maxBytes - bytes;
        const slice = chunk.length > room ? chunk.subarray(0, room) : chunk;
        if (slice.length < chunk.length) truncated = true;
        bytes += slice.length;
        if (target === 'out') stdout += slice.toString('utf8');
        else stderr += slice.toString('utf8');
      };
      child.stdout?.on('data', collect('out'));
      child.stderr?.on('data', collect('err'));
      child.stdin?.on('error', () => undefined);
      child.stdin?.end(options.input ?? '');

      const timer = setTimeout(() => {
        timedOut = true;
        killTree(child.pid);
      }, timeoutMs);

      child.once('error', (error) => {
        spawnError = error.message;
      });
      child.once('close', (code, signal) => {
        clearTimeout(timer);
        this.active.delete(tracked);
        resolve({
          // Gagal dijalankan: libuv mengisi kode galat negatif, bukan kode keluar program.
          code: spawnError ? null : code,
          signal,
          stdout,
          stderr,
          timedOut,
          truncated,
          ...(spawnError ? { spawnError } : {}),
        });
      });
    });
  }
}

const emptyResult = (extra: Partial<ProcessResult>): ProcessResult => ({
  code: null,
  signal: null,
  stdout: '',
  stderr: '',
  timedOut: false,
  truncated: false,
  ...extra,
});

function exited(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    child.once('close', () => resolve());
    child.once('error', () => resolve());
  });
}
