import { promises as fs } from 'node:fs';
import nodePath from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProjectSetupSchema, type AgentEvent, type ProjectSetup } from '@aios/contracts';
import { z } from 'zod';
import type { ProcessManager } from '../process/manager.js';

const FileSchema = z.object({
  version: z.literal(1),
  projects: z.record(z.string(), ProjectSetupSchema),
});

const EMPTY: ProjectSetup = { commands: [], linkNodeModules: false, lsp: true };

/**
 * Penyiapan worktree per project, disimpan di worker (bukan di repo): isi repo tidak pernah menentukan
 * apa yang dijalankan di PC ini otomatis. Hanya pemilik yang mengisinya dari desktop.
 */
export class ProjectSetupStore {
  private projects: Record<string, ProjectSetup> = {};

  constructor(private readonly file: string) {}

  async load(): Promise<void> {
    try {
      const parsed = FileSchema.safeParse(JSON.parse(await fs.readFile(this.file, 'utf8')));
      this.projects = parsed.success ? parsed.data.projects : {};
    } catch {
      this.projects = {};
    }
  }

  get(projectId: string): ProjectSetup {
    const found = this.projects[projectId] ?? EMPTY;
    return { ...found, commands: [...found.commands] };
  }

  async set(projectId: string, setup: ProjectSetup): Promise<ProjectSetup> {
    const isDefault =
      setup.commands.length === 0 &&
      setup.linkNodeModules === EMPTY.linkNodeModules &&
      setup.lsp === EMPTY.lsp;
    if (isDefault) delete this.projects[projectId];
    else this.projects[projectId] = { ...setup, commands: [...setup.commands] };
    await fs.mkdir(nodePath.dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    await fs.writeFile(temp, JSON.stringify({ version: 1, projects: this.projects }, null, 2));
    await fs.rename(temp, this.file);
    return this.get(projectId);
  }
}

const SETUP_TIMEOUT_MS = 5 * 60_000;
const OUTPUT_TAIL = 2000;

/**
 * Program dan argumen satu baris perintah. Di Windows pnpm/npm/yarn adalah `.cmd` yang tidak bisa dijalankan
 * tanpa shell, jadi dipanggil lewat `cmd.exe /d /c`; karakter shell sudah ditolak oleh skema.
 */
export function setupSpawn(line: string, win = process.platform === 'win32'): [string, string[]] {
  const [program = '', ...args] = line.trim().split(/\s+/);
  return win ? ['cmd.exe', ['/d', '/c', program, ...args]] : [program, args];
}

export interface SetupRunInput {
  processes: ProcessManager;
  commands: readonly string[];
  cwd: string;
  runId: string;
  emit: (event: AgentEvent) => void;
  isCancelled: () => boolean;
  now?: () => number;
}

/**
 * Menjalankan perintah setup berurutan di worktree dan melaporkannya sebagai langkah `setup` (tampil di chat
 * seperti langkah tool). Berhenti di perintah pertama yang gagal; run tetap dilanjutkan oleh pemanggil.
 */
export async function runSetup(input: SetupRunInput): Promise<boolean> {
  const now = input.now ?? Date.now;
  for (const line of input.commands) {
    if (input.isCancelled()) return false;
    const toolCallId = randomUUID();
    const started = now();
    input.emit({ type: 'tool.started', toolCallId, name: 'setup', target: line });
    const [program, args] = setupSpawn(line);
    const result = await input.processes.run(program, args, {
      cwd: input.cwd,
      runId: input.runId,
      timeoutMs: SETUP_TIMEOUT_MS,
      maxOutputBytes: 256 * 1024,
    });
    const ok = result.code === 0 && !result.timedOut && !result.spawnError;
    const text = result.spawnError ?? `${result.stdout}${result.stderr}`.trim();
    if (text) {
      input.emit({
        type: 'tool.output',
        toolCallId,
        chunk: text.slice(-OUTPUT_TAIL),
        stream: ok ? 'stdout' : 'stderr',
      });
    }
    input.emit({
      type: 'tool.finished',
      toolCallId,
      status: ok ? 'ok' : input.isCancelled() ? 'cancelled' : 'error',
      durationMs: Math.max(0, now() - started),
    });
    if (!ok) return false;
  }
  return true;
}
