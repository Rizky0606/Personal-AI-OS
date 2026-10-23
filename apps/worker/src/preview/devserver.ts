import net from 'node:net';
import type { ProcessManager, TrackedProcess } from '../process/manager.js';
import type { DevCommand } from './devcommand.js';

export class DevServerError extends Error {
  constructor(
    readonly code: 'dev_server_exited' | 'dev_server_timeout' | 'dev_server_start_failed',
    message: string,
    /** Ekor keluaran dev server, untuk ditampilkan agar penyebabnya terlihat. */
    readonly log: string,
  ) {
    super(message);
    this.name = 'DevServerError';
  }
}

export interface DevServerOptions {
  processes: ProcessManager;
  cwd: string;
  command: DevCommand;
  /** Mengelompokkan proses per run, supaya ikut mati saat run selesai. */
  runId?: string | undefined;
  /** Menunggu URL muncul dan server menjawab. */
  readyTimeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  onLog?: (chunk: string) => void;
  /** Proses berhenti (crash atau dihentikan). */
  onExit?: () => void;
}

// Urutan escape ANSI (warna) dari dev server; ESC dibentuk dari kodenya agar tidak memakai karakter kontrol literal.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]`, 'g');
const URL_IN_LOG =
  /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d{2,5})(?:\/[^\s'")\]]*)?/i;
const LOG_TAIL = 6000;
const DEFAULT_READY_MS = 60_000;
/** Bila log tidak menyebut URL, port dari PORT dicoba setelah ini. */
const PORT_FALLBACK_AFTER_MS = 8_000;

/** Port kosong di loopback. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === 'object') resolve(address.port);
        else reject(new Error('port tidak tersedia'));
      });
    });
  });
}

/** Server menjawab HTTP apa pun (bahkan 404) berarti sudah siap menerima koneksi. */
export async function probe(url: string, timeoutMs = 1500): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' });
    return true;
  } catch {
    return false;
  }
}

/** `0.0.0.0` dan `[::]` tidak bisa dibuka klien; diganti loopback. */
function normalizeUrl(raw: string): string {
  const url = new URL(raw);
  if (url.hostname === '0.0.0.0' || url.hostname === '[::]' || url.hostname === '[::1]') {
    url.hostname = '127.0.0.1';
  }
  return `${url.protocol}//${url.host}/`;
}

/**
 * Satu dev server: menjalankan perintah di cwd, mencari URL dari keluarannya (atau port yang kita siapkan lewat
 * PORT), menunggu sampai menjawab, lalu menyimpan ekor lognya. Proses dimatikan beserta turunannya oleh `stop`.
 */
export class DevServer {
  private proc: TrackedProcess | undefined;
  private tail = '';
  private stopped = false;
  private exited = false;
  url: string | undefined;

  constructor(private readonly options: DevServerOptions) {}

  get log(): string {
    return this.tail;
  }

  /** Mulai dan tunggu siap. Menolak dengan [DevServerError] bila proses mati atau waktu habis. */
  async start(): Promise<string> {
    const { options } = this;
    const port = await freePort();
    let proc: TrackedProcess;
    try {
      proc = await options.processes.spawnTracked(options.command.command, options.command.args, {
        cwd: options.cwd,
        ...(options.runId ? { runId: options.runId } : {}),
        env: {
          ...process.env,
          ...options.env,
          PORT: String(port),
          HOST: '127.0.0.1',
          BROWSER: 'none',
          NO_COLOR: '1',
          FORCE_COLOR: '0',
        },
      });
    } catch (error) {
      throw new DevServerError(
        'dev_server_start_failed',
        error instanceof Error ? error.message : 'Dev server gagal dimulai.',
        '',
      );
    }
    this.proc = proc;

    let found: string | undefined;
    const onData = (data: Buffer) => {
      const text = data.toString('utf8').replace(ANSI, '');
      this.tail = (this.tail + text).slice(-LOG_TAIL);
      options.onLog?.(text);
      if (!found) {
        const match = URL_IN_LOG.exec(this.tail);
        if (match) found = normalizeUrl(match[0]);
      }
    };
    proc.child.stdout.on('data', onData);
    proc.child.stderr.on('data', onData);
    proc.child.once('exit', () => {
      this.exited = true;
      options.onExit?.();
    });

    const started = Date.now();
    const deadline = started + (options.readyTimeoutMs ?? DEFAULT_READY_MS);
    while (Date.now() < deadline) {
      if (this.stopped)
        throw new DevServerError('dev_server_exited', 'Preview dihentikan.', this.tail);
      if (this.exited) {
        throw new DevServerError(
          'dev_server_exited',
          `Dev server berhenti sebelum siap (${options.command.label}). Lihat log untuk sebabnya.`,
          this.tail,
        );
      }
      const candidate =
        found ??
        (Date.now() - started > PORT_FALLBACK_AFTER_MS ? `http://127.0.0.1:${port}/` : undefined);
      if (candidate && (await probe(candidate))) {
        this.url = candidate;
        return candidate;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    this.stop();
    throw new DevServerError(
      'dev_server_timeout',
      `Dev server tidak menjawab dalam ${Math.round((options.readyTimeoutMs ?? DEFAULT_READY_MS) / 1000)} detik (${options.command.label}).`,
      this.tail,
    );
  }

  stop(): void {
    this.stopped = true;
    this.proc?.kill();
    this.proc = undefined;
  }

  /** Proses sudah berhenti sendiri (crash) setelah sempat siap. */
  get dead(): boolean {
    return this.exited;
  }
}
