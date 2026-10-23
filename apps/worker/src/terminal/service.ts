import { randomBytes } from 'node:crypto';
import type { TerminalInfo } from '@aios/contracts';
import { spawnBunPty, type PtyProcess, type PtySpawn } from './pty.js';

export class TerminalError extends Error {
  constructor(
    readonly code: 'terminal_unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'TerminalError';
  }
}

export interface TerminalTarget {
  projectId: string;
  runId?: string | undefined;
}

const REPLAY_BYTES = 64 * 1024;
const MAX_TERMINALS = 8;

interface Terminal {
  id: string;
  key: string;
  runId: string | undefined;
  cwd: string;
  shell: string;
  proc: PtyProcess | undefined;
  replay: string;
  exitCode: number | null;
}

export interface TerminalServiceOptions {
  /** Folder kerja: worktree run bila runId diisi, selain itu folder project. Melempar bila tidak bisa. */
  resolveCwd: (target: TerminalTarget) => Promise<string>;
  spawn?: PtySpawn;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  onData: (terminalId: string, data: string) => void;
  onExit: (terminalId: string, exitCode: number | null) => void;
  log?: (message: string) => void;
}

export const terminalKey = (t: TerminalTarget): string =>
  t.runId ? `run:${t.runId}` : `project:${t.projectId}`;

/** Lingkungan shell: tanpa variabel AIOS_* (token worker dan sejenisnya tidak boleh terlihat dari shell). */
export function shellEnv(base: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(base)) {
    if (value !== undefined && !name.toUpperCase().startsWith('AIOS_')) env[name] = value;
  }
  env.TERM = 'xterm-256color';
  return env;
}

export function defaultShell(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): { command: string; args: string[] } {
  if (platform === 'win32') return { command: 'powershell.exe', args: ['-NoLogo'] };
  return { command: env.SHELL ?? '/bin/bash', args: [] };
}

/**
 * Terminal terpadu: satu shell sungguhan (PTY) per project, atau per worktree run. Cwd awal selalu folder
 * project/worktree yang terikat; setelah itu pengguna bebas berpindah seperti di terminal biasa. Keluaran
 * terakhir disimpan agar tab yang dibuka ulang tidak kosong.
 */
export class TerminalService {
  private readonly terminals = new Map<string, Terminal>();
  private readonly spawn: PtySpawn;

  constructor(private readonly options: TerminalServiceOptions) {
    this.spawn = options.spawn ?? spawnBunPty;
  }

  async open(target: TerminalTarget, size: { cols: number; rows: number }): Promise<TerminalInfo> {
    const key = terminalKey(target);
    const existing = this.terminals.get(key);
    if (existing?.exitCode === null) {
      existing.proc?.resize(size.cols, size.rows);
      return this.info(existing);
    }
    // Shell yang sudah berhenti diganti dengan yang baru.
    if (existing) this.terminals.delete(key);
    if (this.terminals.size >= MAX_TERMINALS) {
      throw new TerminalError(
        'terminal_unavailable',
        `Maksimal ${MAX_TERMINALS} terminal terbuka. Tutup yang tidak dipakai.`,
      );
    }

    let cwd: string;
    try {
      cwd = await this.options.resolveCwd(target);
    } catch (error) {
      throw new TerminalError(
        'terminal_unavailable',
        error instanceof Error ? error.message : 'Folder terminal tidak tersedia.',
      );
    }
    const env = this.options.env ?? process.env;
    const shell = defaultShell(this.options.platform ?? process.platform, env);
    const terminal: Terminal = {
      id: `term-${randomBytes(6).toString('hex')}`,
      key,
      runId: target.runId,
      cwd,
      shell: shell.command,
      proc: undefined,
      replay: '',
      exitCode: null,
    };
    try {
      terminal.proc = this.spawn({
        command: shell.command,
        args: shell.args,
        cwd,
        env: shellEnv(env),
        cols: size.cols,
        rows: size.rows,
        onData: (data) => {
          terminal.replay = (terminal.replay + data).slice(-REPLAY_BYTES);
          this.options.onData(terminal.id, data);
        },
        onExit: (code) => {
          terminal.exitCode = code;
          this.options.onExit(terminal.id, code);
        },
      });
    } catch (error) {
      this.options.log?.(`terminal gagal dimulai: ${String(error)}`);
      throw new TerminalError(
        'terminal_unavailable',
        error instanceof Error ? error.message : 'Terminal gagal dimulai.',
      );
    }
    this.terminals.set(key, terminal);
    return this.info(terminal);
  }

  private info(t: Terminal): TerminalInfo {
    return { id: t.id, cwd: t.cwd, shell: t.shell, replay: t.replay, exitCode: t.exitCode };
  }

  private byId(id: string): Terminal {
    for (const t of this.terminals.values()) if (t.id === id) return t;
    throw new TerminalError('terminal_unavailable', 'Terminal ini sudah ditutup.');
  }

  write(id: string, data: string): void {
    const t = this.byId(id);
    if (t.exitCode === null) t.proc?.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    const t = this.byId(id);
    if (t.exitCode === null) t.proc?.resize(cols, rows);
  }

  close(id: string): void {
    const t = this.byId(id);
    this.terminals.delete(t.key);
    if (t.exitCode === null) t.proc?.kill();
  }

  /** Worktree run akan dihapus: terminal di dalamnya ditutup dulu (shell yang menahan folder menggagalkan penghapusan). */
  closeByRun(runId: string): void {
    for (const t of [...this.terminals.values()]) {
      if (t.runId === runId) this.close(t.id);
    }
  }

  closeAll(): void {
    for (const t of [...this.terminals.values()]) this.close(t.id);
  }

  get count(): number {
    return this.terminals.size;
  }
}
