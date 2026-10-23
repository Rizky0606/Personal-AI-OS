import { promises as fs } from 'node:fs';
import nodePath from 'node:path';
import { WORKER_BRANCH_PREFIX, workerBranchFor } from '@aios/contracts';
import type { AllowList } from '../paths/allowlist.js';
import { isInside } from '../paths/normalize.js';
import type { ProcessManager } from '../process/manager.js';

export class WorktreeError extends Error {
  constructor(
    readonly code: 'not_a_repo' | 'no_commits' | 'worktree_failed',
    message: string,
  ) {
    super(message);
    this.name = 'WorktreeError';
  }
}

/** Ref tersembunyi berisi rantai checkpoint satu worktree; stabil walau worktree berpindah ke run lanjutan. */
export const checkpointRef = (wt: Pick<Worktree, 'branch'>): string =>
  `refs/aios/cp/${wt.branch.slice(WORKER_BRANCH_PREFIX.length)}`;

export interface Worktree {
  runId: string;
  /** Akar repo git dari project. */
  repo: string;
  /** Folder worktree (akar repo di worktree). */
  root: string;
  /** Folder kerja agent: sama dengan project, tetapi di dalam worktree. */
  cwd: string;
  branch: string;
  /** Commit dasar (HEAD repo asli saat run dimulai). */
  base: string;
}

const GIT_TIMEOUT_MS = 60_000;
const WORKTREES_DIR = '.aios-worktrees';
const COMMIT_ENV = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'Personal AI OS',
  GIT_AUTHOR_EMAIL: 'aios@localhost',
  GIT_COMMITTER_NAME: 'Personal AI OS',
  GIT_COMMITTER_EMAIL: 'aios@localhost',
};

/**
 * Worktree git per run (ARCHITECTURE.md, "Alur utama: run coding"): agent bekerja di folder terpisah pada
 * branch `aios/<id pendek>`, jadi branch dan file kerja pengguna tidak disentuh sampai hasilnya diterima.
 * Lokasi: `.aios-worktrees` di samping repo bila folder itu masih di dalam folder yang diizinkan; kalau
 * tidak, di folder data worker. Dua-duanya di luar repo kerja.
 */
export class WorktreeManager {
  private readonly active = new Map<string, Worktree>();
  private readonly removing = new Set<string>();

  constructor(
    private readonly deps: {
      processes: ProcessManager;
      allowed: AllowList;
      /** Folder data worker; dipakai bila `.aios-worktrees` di samping repo di luar folder izin. */
      dataDir: string;
    },
  ) {}

  /** Path ini ada di dalam worktree yang sedang dikelola? Dipakai pemeriksaan cwd proses anak. */
  contains(path: string): boolean {
    return [...this.active.values()].some((w) => isInside(w.root, path));
  }

  get(runId: string): Worktree | undefined {
    return this.active.get(runId);
  }

  async create(runId: string, projectPath: string): Promise<Worktree> {
    const repo = await this.git(projectPath, ['rev-parse', '--show-toplevel']).catch(() => {
      throw new WorktreeError(
        'not_a_repo',
        'Folder project ini bukan repo git. Jalankan git init lebih dulu.',
      );
    });
    const repoRoot = await fs.realpath(repo);
    const base = await this.git(repoRoot, ['rev-parse', '--verify', 'HEAD']).catch(() => {
      throw new WorktreeError(
        'no_commits',
        'Repo belum punya commit. Buat satu commit awal lebih dulu.',
      );
    });

    const branch = workerBranchFor(runId);
    const root = await this.chooseRoot(repoRoot, branch);
    await fs.mkdir(nodePath.dirname(root), { recursive: true });
    await this.git(repoRoot, ['worktree', 'add', '-b', branch, root, base]).catch(
      (error: unknown) => {
        throw new WorktreeError('worktree_failed', `Worktree gagal dibuat: ${message(error)}`);
      },
    );

    const real = await fs.realpath(root);
    const relative = nodePath.relative(repoRoot, await fs.realpath(projectPath));
    const worktree: Worktree = {
      runId,
      repo: repoRoot,
      root: real,
      cwd: relative === '' ? real : nodePath.join(real, relative),
      branch,
      base,
    };
    this.active.set(runId, worktree);
    return worktree;
  }

  /** Tidak ada perubahan sama sekali: tidak ada file berubah dan tidak ada commit baru. */
  async isPristine(runId: string): Promise<boolean> {
    const wt = this.active.get(runId);
    if (!wt) return false;
    try {
      const status = await this.git(wt.root, ['status', '--porcelain']);
      const head = await this.git(wt.root, ['rev-parse', 'HEAD']);
      return status === '' && head === wt.base;
    } catch {
      return false;
    }
  }

  /**
   * Run lanjutan (revisi setelah komentar review) memakai worktree run sebelumnya: entri dipindahkan ke id
   * run baru. Branch dan base tetap, jadi diff selalu terhadap titik awal pekerjaan.
   */
  adopt(fromRunId: string, toRunId: string): Worktree {
    const wt = this.active.get(fromRunId);
    if (!wt || this.removing.has(fromRunId)) {
      throw new WorktreeError(
        'worktree_failed',
        'Worktree run sebelumnya sudah tidak ada (worker dimulai ulang atau hasilnya sudah dibuang).',
      );
    }
    const next: Worktree = { ...wt, runId: toRunId };
    this.active.delete(fromRunId);
    this.active.set(toRunId, next);
    return next;
  }

  /** Menyimpan perubahan agent sebagai satu commit di branch kerja (branch tetap ada untuk pengguna). */
  async commitAll(runId: string, commitMessage: string): Promise<boolean> {
    const wt = this.active.get(runId);
    if (!wt) return false;
    await this.git(wt.root, ['add', '-A']);
    const status = await this.git(wt.root, ['status', '--porcelain']);
    if (status === '') return false;
    await this.git(wt.root, ['commit', '-q', '-m', commitMessage]);
    return true;
  }

  /** Menghapus worktree; `deleteBranch` juga menghapus branch kerjanya (ditolak / tanpa perubahan). */
  async remove(runId: string, { deleteBranch }: { deleteBranch: boolean }): Promise<void> {
    const wt = this.active.get(runId);
    if (!wt || this.removing.has(runId)) return;
    this.removing.add(runId);
    try {
      await this.git(wt.repo, ['worktree', 'remove', '--force', wt.root]).catch(() => undefined);
      await fs.rm(wt.root, { recursive: true, force: true }).catch(() => undefined);
      await this.git(wt.repo, ['worktree', 'prune']).catch(() => undefined);
      await this.git(wt.repo, ['update-ref', '-d', checkpointRef(wt)]).catch(() => undefined);
      if (deleteBranch) await this.git(wt.repo, ['branch', '-D', wt.branch]).catch(() => undefined);
    } finally {
      // Dilepas setelah selesai: yang melihat worktree hilang boleh yakin pembersihannya tuntas.
      this.active.delete(runId);
      this.removing.delete(runId);
    }
  }

  private async chooseRoot(repoRoot: string, branch: string): Promise<string> {
    const name = `${nodePath.basename(repoRoot)}-${branch.slice('aios/'.length)}`;
    const sibling = nodePath.join(nodePath.dirname(repoRoot), WORKTREES_DIR, name);
    const allowedSibling = await this.deps.allowed.resolve(sibling).then(
      () => true,
      () => false,
    );
    return allowedSibling ? sibling : nodePath.join(this.deps.dataDir, 'worktrees', name);
  }

  /** Menjalankan git di `cwd`. `raw` mempertahankan keluaran apa adanya (untuk -z dan patch). */
  async git(
    cwd: string,
    args: string[],
    options: { maxOutputBytes?: number; raw?: boolean; env?: Record<string, string> } = {},
  ): Promise<string> {
    const result = await this.deps.processes.run('git', args, {
      cwd,
      timeoutMs: GIT_TIMEOUT_MS,
      maxOutputBytes: options.maxOutputBytes ?? 256 * 1024,
      env: { ...process.env, ...COMMIT_ENV, ...options.env },
    });
    if (result.spawnError) throw new Error('git tidak ditemukan di PC ini.');
    if (result.code !== 0) {
      const first = result.stderr.trim().split('\n')[0];
      throw new Error(first === undefined || first === '' ? `git ${args[0] ?? ''} gagal` : first);
    }
    return options.raw ? result.stdout : result.stdout.trim();
  }
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
