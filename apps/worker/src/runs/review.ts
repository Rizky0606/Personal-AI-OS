import { promises as fs } from 'node:fs';
import nodePath from 'node:path';
import type {
  Checkpoint,
  LocalErrorCode,
  MergeSkipped,
  ReviewFile,
  ReviewState,
} from '@aios/contracts';
import { fallbackCommitMessage, parseCommitMessage } from './commit-message.js';
import { checkpointRef, type Worktree, type WorktreeManager } from './worktree.js';

export class ReviewError extends Error {
  constructor(
    readonly code: Extract<LocalErrorCode, 'review_not_found' | 'git_failed' | 'run_active'>,
    message: string,
  ) {
    super(message);
    this.name = 'ReviewError';
  }
}

export interface ReviewOutcome {
  branch: string;
  commit: string | null;
  merged: boolean;
  mergeSkipped: MergeSkipped | null;
}

const MAX_FILES_WITH_PATCH = 200;
const MAX_PATCH_BYTES = 200_000;
const MAX_STAT_FILES = 2000;
const LOCK_RETRIES = 6;
const LOCK_WAIT_MS = 150;

type Status = ReviewFile['status'];
interface Change {
  path: string;
  oldPath?: string;
  status: Status;
}
interface Stat {
  path: string;
  additions: number;
  deletions: number;
  binary: boolean;
}

/** `git diff --name-status -z -M`: `M\0path\0` atau `R100\0lama\0baru\0`. */
export function parseNameStatus(raw: string): Change[] {
  const tokens = raw.split('\0');
  const changes: Change[] = [];
  for (let i = 0; i < tokens.length;) {
    const code = tokens[i++] ?? '';
    if (code === '') continue;
    const letter = code.charAt(0);
    if (letter === 'R' || letter === 'C') {
      const oldPath = tokens[i++];
      const path = tokens[i++];
      if (oldPath !== undefined && path !== undefined) {
        changes.push({ path, status: letter === 'R' ? 'renamed' : 'added', oldPath });
      }
      continue;
    }
    const path = tokens[i++];
    if (path === undefined) continue;
    changes.push({
      path,
      status: letter === 'A' ? 'added' : letter === 'D' ? 'deleted' : 'modified',
    });
  }
  return changes;
}

/** `git diff --numstat -z -M`: `tambah\thapus\tpath\0` atau `tambah\thapus\t\0lama\0baru\0`; biner `-\t-`. */
export function parseNumstat(raw: string): Stat[] {
  const tokens = raw.split('\0');
  const stats: Stat[] = [];
  for (let i = 0; i < tokens.length;) {
    const token = tokens[i++] ?? '';
    if (token === '') continue;
    const [add = '', del = '', ...rest] = token.split('\t');
    let path = rest.join('\t');
    if (path === '') {
      i++; // nama lama pada rename
      path = tokens[i++] ?? '';
    }
    const binary = add === '-' || del === '-';
    stats.push({
      path,
      additions: binary ? 0 : Number(add) || 0,
      deletions: binary ? 0 : Number(del) || 0,
      binary,
    });
  }
  return stats;
}

/**
 * Tinjauan hasil run coding di worker: diff worktree terhadap base, checkpoint, undo, dan terima
 * (commit, opsional merge ke branch kerja pengguna). Checkpoint disimpan sebagai commit pada ref
 * tersembunyi `refs/aios/cp/<id>` (bukan di branch), jadi riwayat branch kerja tetap bersih dan
 * hasil terima hanya satu commit.
 */
export class ReviewService {
  private readonly meta = new Map<string, { text: string; commit: string | undefined }>();
  private readonly chains = new Map<string, Promise<unknown>>();

  constructor(
    private readonly deps: {
      worktrees: WorktreeManager;
      /** Run masih berjalan di worker: worktree tidak boleh diubah dari luar. */
      isWorking: (runId: string) => boolean;
    },
  ) {}

  /** Teks jawaban agent (ekor) dan pesan commit yang ditulisnya; diisi koordinator saat run selesai. */
  setMeta(runId: string, text: string): void {
    // Pesan commit dari run pertama menggambarkan seluruh perubahan; revisi tidak menimpanya.
    const previous = this.meta.get(runId)?.commit;
    this.meta.set(runId, { text, commit: previous ?? parseCommitMessage(text) });
  }

  /** Run lanjutan mewarisi usulan pesan commit run sebelumnya. */
  inherit(fromRunId: string, toRunId: string): void {
    const meta = this.meta.get(fromRunId);
    if (!meta) return;
    this.meta.delete(fromRunId);
    this.meta.set(toRunId, meta);
  }

  forget(runId: string): void {
    this.meta.delete(runId);
  }

  async get(runId: string): Promise<ReviewState> {
    return this.exclusive(runId, async () => {
      const wt = this.worktree(runId);
      const { files } = await this.collect(wt, true);
      return {
        runId,
        branch: wt.branch,
        base: wt.base,
        targetBranch: await this.currentBranch(wt),
        commitMessage: this.commitMessage(runId, files),
        files,
        checkpoints: await this.listCheckpoints(wt),
      };
    });
  }

  /** Ringkasan tambah/hapus per file tanpa isi patch (untuk event `diff.updated`). */
  async stat(runId: string): Promise<{ path: string; additions: number; deletions: number }[]> {
    return this.exclusive(runId, async () => {
      const wt = this.worktree(runId);
      const { files } = await this.collect(wt, false);
      return files.map(({ path, additions, deletions }) => ({ path, additions, deletions }));
    });
  }

  /** Membuat checkpoint bila isi worktree berubah sejak checkpoint terakhir; null bila sama. */
  async checkpoint(runId: string, label: string): Promise<Checkpoint | null> {
    return this.exclusive(runId, async () => {
      const wt = this.worktree(runId);
      const ref = checkpointRef(wt);
      const git = this.git(wt);
      const tree = await this.snapshot(wt);
      const parent =
        (await git(wt.repo, ['rev-parse', '--verify', '-q', ref]).catch(() => '')) || wt.base;
      const parentTree = await git(wt.repo, ['rev-parse', `${parent}^{tree}`]);
      if (tree === parentTree) return null;
      const id = await git(wt.repo, ['commit-tree', tree, '-p', parent, '-m', label.slice(0, 200)]);
      await git(wt.repo, ['update-ref', ref, id]);
      return { id, label, ts: new Date().toISOString() };
    });
  }

  /** Mengembalikan worktree ke `base` atau ke satu checkpoint; checkpoint sesudahnya dibuang. */
  async undo(runId: string, checkpointId: string): Promise<ReviewState> {
    await this.exclusive(runId, async () => {
      const wt = this.worktree(runId);
      this.assertIdle(runId);
      const git = this.git(wt);
      const target =
        checkpointId === 'base' ? wt.base : await this.resolveCheckpoint(wt, checkpointId);
      await git(wt.root, ['add', '-A']); // supaya berkas baru ikut terhapus oleh read-tree
      await git(wt.root, ['read-tree', '-u', '--reset', target]);
      const ref = checkpointRef(wt);
      if (target === wt.base) await git(wt.repo, ['update-ref', '-d', ref]).catch(() => undefined);
      else await git(wt.repo, ['update-ref', ref, target]);
    });
    return this.get(runId);
  }

  /** Mengembalikan satu berkas ke keadaan di base (menolak perubahan agent pada berkas itu). */
  async revertFile(runId: string, path: string): Promise<ReviewState> {
    await this.exclusive(runId, async () => {
      const wt = this.worktree(runId);
      this.assertIdle(runId);
      const git = this.git(wt);
      const tree = await this.snapshot(wt);
      const names = await git(
        wt.root,
        ['diff', '--no-color', '--no-ext-diff', '--name-status', '-z', '-M', wt.base, tree],
        { raw: true },
      );
      const change = parseNameStatus(names).find((c) => c.path === path);
      if (!change) throw new ReviewError('review_not_found', 'Berkas itu tidak berubah.');

      const targets = [change.path, ...(change.oldPath ? [change.oldPath] : [])];
      for (const target of targets) {
        const inBase = await git(wt.root, ['cat-file', '-e', `${wt.base}:${target}`]).then(
          () => true,
          () => false,
        );
        if (inBase) {
          await git(wt.root, ['--literal-pathspecs', 'checkout', wt.base, '--', target]);
        } else {
          await git(wt.root, [
            '--literal-pathspecs',
            'rm',
            '-q',
            '-f',
            '--cached',
            '--ignore-unmatch',
            '--',
            target,
          ]);
          await fs.rm(nodePath.join(wt.root, target), { force: true });
        }
      }
    });
    return this.get(runId);
  }

  /**
   * Terima: semua perubahan menjadi satu commit di branch kerja agent. Dengan `merge`, branch digabungkan ke
   * branch kerja pengguna hanya bila itu fast-forward dan working tree-nya bersih; selain itu branch dibiarkan.
   */
  async accept(
    runId: string,
    options: { merge: boolean; commitMessage?: string | undefined },
  ): Promise<ReviewOutcome> {
    const wt = this.worktree(runId);
    this.assertIdle(runId);
    const outcome = await this.exclusive(runId, async (): Promise<ReviewOutcome> => {
      const git = this.git(wt);
      await git(wt.root, ['add', '-A']);
      const status = await git(wt.root, ['status', '--porcelain']);
      let commit: string | null = null;
      if (status !== '') {
        const { files } = await this.collect(wt, false);
        const message = options.commitMessage ?? this.commitMessage(runId, files);
        await git(wt.root, ['commit', '-q', '-m', message]);
        commit = await git(wt.root, ['rev-parse', 'HEAD']);
      } else if ((await git(wt.root, ['rev-parse', 'HEAD'])) !== wt.base) {
        commit = await git(wt.root, ['rev-parse', 'HEAD']);
      }
      return { branch: wt.branch, commit, merged: false, mergeSkipped: null };
    });

    await this.deps.worktrees.remove(runId, { deleteBranch: outcome.commit === null });
    this.forget(runId);
    if (outcome.commit === null) return { ...outcome, mergeSkipped: 'nothing_to_merge' };
    if (!options.merge) return outcome;

    const skipped = await this.tryMerge(wt);
    if (skipped) return { ...outcome, mergeSkipped: skipped };
    // Sudah ada di branch kerja pengguna; branch sementara tidak diperlukan lagi.
    await this.deps.worktrees.git(wt.repo, ['branch', '-d', wt.branch]).catch(() => undefined);
    return { ...outcome, merged: true };
  }

  async reject(runId: string): Promise<ReviewOutcome> {
    const wt = this.worktree(runId);
    this.assertIdle(runId);
    await this.deps.worktrees.remove(runId, { deleteBranch: true });
    this.forget(runId);
    return { branch: wt.branch, commit: null, merged: false, mergeSkipped: null };
  }

  private async tryMerge(wt: Worktree): Promise<MergeSkipped | null> {
    const git = this.git(wt);
    const head = await git(wt.repo, ['symbolic-ref', '-q', 'HEAD']).catch(() => '');
    if (head === '') return 'detached';
    const dirty = await git(wt.repo, ['status', '--porcelain', '--untracked-files=no']);
    if (dirty !== '') return 'dirty';
    try {
      await git(wt.repo, ['merge', '--ff-only', '-q', wt.branch]);
      return null;
    } catch {
      return 'not_fast_forward';
    }
  }

  private commitMessage(runId: string, files: { path: string }[]): string {
    const meta = this.meta.get(runId);
    return (
      meta?.commit ??
      fallbackCommitMessage(
        meta?.text ?? '',
        files.map((f) => f.path),
      )
    );
  }

  private async collect(wt: Worktree, withPatch: boolean): Promise<{ files: ReviewFile[] }> {
    const git = this.git(wt);
    const tree = await this.snapshot(wt);
    const diffArgs = ['diff', '--no-color', '--no-ext-diff', '-M', '-z'];
    const names = parseNameStatus(
      await git(wt.root, [...diffArgs, '--name-status', wt.base, tree], { raw: true }),
    );
    const stats = new Map(
      parseNumstat(
        await git(wt.root, [...diffArgs, '--numstat', wt.base, tree], { raw: true }),
      ).map((s) => [s.path, s]),
    );

    const files: ReviewFile[] = [];
    for (const [index, change] of names.slice(0, MAX_STAT_FILES).entries()) {
      const stat = stats.get(change.path);
      let patch = '';
      let truncated = false;
      if (withPatch && !stat?.binary) {
        if (index >= MAX_FILES_WITH_PATCH) {
          truncated = true;
        } else {
          const paths = [change.path, ...(change.oldPath ? [change.oldPath] : [])];
          patch = await git(
            wt.root,
            [
              '--literal-pathspecs',
              'diff',
              '--no-color',
              '--no-ext-diff',
              '-M',
              wt.base,
              tree,
              '--',
              ...paths,
            ],
            { raw: true, maxOutputBytes: MAX_PATCH_BYTES },
          );
          if (patch.length >= MAX_PATCH_BYTES - 1024) truncated = true;
        }
      }
      files.push({
        path: change.path,
        status: change.status,
        ...(change.oldPath ? { oldPath: change.oldPath } : {}),
        additions: stat?.additions ?? 0,
        deletions: stat?.deletions ?? 0,
        binary: stat?.binary ?? false,
        patch,
        truncated,
      });
    }
    return { files };
  }

  /**
   * Isi worktree saat ini sebagai tree git, lewat index pribadi: index milik worktree juga dipakai git di
   * dalam omp (dan bisa terkunci), jadi pembacaan selama run tidak boleh menyentuhnya.
   */
  private async snapshot(wt: Worktree): Promise<string> {
    const git = this.git(wt);
    const gitDir = await git(wt.root, ['rev-parse', '--absolute-git-dir']);
    const env = { GIT_INDEX_FILE: nodePath.join(gitDir, 'aios-index') };
    await git(wt.root, ['add', '-A'], { env });
    return git(wt.root, ['write-tree'], { env });
  }

  private async listCheckpoints(wt: Worktree): Promise<Checkpoint[]> {
    const ref = checkpointRef(wt);
    const exists = await this.git(wt)(wt.repo, ['rev-parse', '--verify', '-q', ref]).catch(
      () => '',
    );
    if (exists === '') return [];
    const out = await this.git(wt)(
      wt.repo,
      ['log', '--reverse', '--format=%H%x1f%s%x1f%cI', `${wt.base}..${ref}`],
      { raw: true },
    );
    return out
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => {
        const [id = '', label = '', ts = ''] = line.split('\x1f');
        return { id, label, ts: new Date(ts).toISOString() };
      });
  }

  private async resolveCheckpoint(wt: Worktree, id: string): Promise<string> {
    const known = (await this.listCheckpoints(wt)).find((c) => c.id === id);
    if (!known) throw new ReviewError('review_not_found', 'Checkpoint itu tidak ada.');
    return known.id;
  }

  private async currentBranch(wt: Worktree): Promise<string | null> {
    const name = await this.git(wt)(wt.repo, ['symbolic-ref', '--short', '-q', 'HEAD']).catch(
      () => '',
    );
    return name === '' ? null : name;
  }

  private worktree(runId: string): Worktree {
    const wt = this.deps.worktrees.get(runId);
    if (!wt) {
      throw new ReviewError(
        'review_not_found',
        'Hasil run ini sudah tidak ada di PC ini (sudah diterima, ditolak, atau worker dimulai ulang).',
      );
    }
    return wt;
  }

  private assertIdle(runId: string): void {
    if (this.deps.isWorking(runId)) {
      throw new ReviewError(
        'run_active',
        'Run masih berjalan. Tunggu sampai selesai atau hentikan dulu.',
      );
    }
  }

  private git(wt: Worktree) {
    return async (
      cwd: string,
      args: string[],
      options?: { raw?: boolean; maxOutputBytes?: number; env?: Record<string, string> },
    ): Promise<string> => {
      for (let attempt = 1; ; attempt++) {
        try {
          return await this.deps.worktrees.git(cwd, args, options);
        } catch (error) {
          const text = error instanceof Error ? error.message : String(error);
          // Git milik agent sedang memakai index yang sama: coba lagi sebentar.
          if (text.includes('.lock') && attempt < LOCK_RETRIES) {
            await new Promise((r) => setTimeout(r, LOCK_WAIT_MS));
            continue;
          }
          throw new ReviewError('git_failed', `git gagal (${wt.branch}): ${text}`);
        }
      }
    };
  }

  /** Operasi git pada satu worktree tidak boleh saling menyalip (index git bersama). */
  private exclusive<T>(runId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(runId) ?? Promise.resolve();
    const next = previous.then(task, task);
    this.chains.set(
      runId,
      next.catch(() => undefined),
    );
    return next;
  }
}
