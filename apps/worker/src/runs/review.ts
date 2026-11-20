import { promises as fs } from 'node:fs';
import nodePath from 'node:path';
import type {
  Checkpoint,
  HeadMoved,
  LocalErrorCode,
  MergeSkipped,
  ReviewFile,
  ReviewState,
} from '@aios/contracts';
import {
  combineCommitMessages,
  fallbackCommitMessage,
  parseCommitMessage,
  summaryLine,
} from './commit-message.js';
import type { InPlaceWorkspace, Workspace, Worktree, WorktreeManager } from './worktree.js';

export class ReviewError extends Error {
  constructor(
    readonly code: Extract<
      LocalErrorCode,
      'review_not_found' | 'git_failed' | 'run_active' | 'head_moved'
    >,
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
const ASSERT_IDLE_RETRIES = 10;
const ASSERT_IDLE_WAIT_MS = 50;

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
 * Tinjauan hasil run coding di worker: diff folder kerja terhadap base, checkpoint, undo, terima, dan tolak.
 * Checkpoint disimpan sebagai commit pada ref tersembunyi per run (`refs/aios/cp/<id run>`, bukan di branch), jadi
 * riwayat branch tetap bersih dan hasil terima hanya satu commit.
 * - `worktree`: terima = satu commit di branch `aios/...`, lalu (opsional) digabung ke branch kerja pengguna;
 *   tolak = worktree dan branch dibuang.
 * - `in_place`: terima = satu commit langsung di branch aktif project; tolak = folder project dikembalikan tepat ke
 *   isi base dan hanya berkas buatan run yang dihapus (berkas yang diabaikan git tidak pernah disentuh).
 */
export class ReviewService {
  private readonly chains = new Map<string, Promise<unknown>>();

  constructor(
    private readonly deps: {
      worktrees: WorktreeManager;
      /** Run masih berjalan di worker: folder kerjanya tidak boleh diubah dari luar. */
      isWorking: (runId: string) => boolean;
    },
  ) {}

  /**
   * Teks jawaban agent (ekor) dan pesan commit yang ditulisnya; diisi koordinator saat run selesai. Disimpan bersama
   * catatan folder kerja (`workspaces.json`), jadi usulan pesan bertahan saat worker dimulai ulang (uji project N3).
   */
  async setMeta(runId: string, text: string): Promise<void> {
    await this.deps.worktrees.setProposal(runId, {
      summary: (summaryLine(text) ?? '').slice(0, 200),
      commit: parseCommitMessage(text),
      commits: this.deps.worktrees.proposal(runId)?.commits ?? [],
    });
  }

  /**
   * Run lanjutan masuk tinjauan yang sama (folder kerjanya sudah diambil alih lewat `WorktreeManager.adopt`): pesan
   * run sebelumnya disimpan, lalu pesan yang diusulkan menggabungkan semua run (lihat `combineCommitMessages`), karena
   * satu commit hasil terima memuat perubahan semuanya.
   */
  async inherit(runId: string): Promise<void> {
    const previous = this.deps.worktrees.proposal(runId);
    if (!previous) return;
    await this.deps.worktrees.setProposal(runId, {
      summary: previous.summary,
      commits: previous.commit ? [...previous.commits, previous.commit] : previous.commits,
    });
  }

  async get(runId: string): Promise<ReviewState> {
    return this.exclusive(runId, async () => {
      const wt = this.workspace(runId);
      const { files } = await this.collect(wt, true);
      return {
        runId,
        branch: wt.branch,
        base: wt.base,
        targetBranch: await this.currentBranch(wt),
        commitMessage: this.commitMessage(runId, files),
        files,
        checkpoints: await this.listCheckpoints(wt),
        workspace: wt.kind,
        headMoved: wt.kind === 'in_place' ? await this.headMoved(wt) : null,
      };
    });
  }

  /** Ringkasan tambah/hapus per file tanpa isi patch (untuk event `diff.updated`). */
  async stat(runId: string): Promise<{ path: string; additions: number; deletions: number }[]> {
    return this.exclusive(runId, async () => {
      const wt = this.workspace(runId);
      const { files } = await this.collect(wt, false);
      return files.map(({ path, additions, deletions }) => ({ path, additions, deletions }));
    });
  }

  /** Membuat checkpoint bila isi folder kerja berubah sejak checkpoint terakhir; null bila sama. */
  async checkpoint(runId: string, label: string): Promise<Checkpoint | null> {
    return this.exclusive(runId, async () => {
      const wt = this.workspace(runId);
      const git = this.git(wt);
      const tree = await this.snapshot(wt);
      const parent =
        (await git(wt.repo, ['rev-parse', '--verify', '-q', wt.checkpointRef]).catch(() => '')) ||
        wt.base;
      const parentTree = await git(wt.repo, ['rev-parse', `${parent}^{tree}`]);
      if (tree === parentTree) return null;
      const id = await git(wt.repo, ['commit-tree', tree, '-p', parent, '-m', label.slice(0, 200)]);
      await git(wt.repo, ['update-ref', wt.checkpointRef, id]);
      return { id, label, ts: new Date().toISOString() };
    });
  }

  /** Mengembalikan folder kerja ke `base` atau ke satu checkpoint; checkpoint sesudahnya dibuang. */
  async undo(runId: string, checkpointId: string): Promise<ReviewState> {
    await this.exclusive(runId, async () => {
      const wt = this.workspace(runId);
      await this.assertIdle(runId);
      const git = this.git(wt);
      const target =
        checkpointId === 'base' ? wt.base : await this.resolveCheckpoint(wt, checkpointId);
      if (wt.kind === 'in_place') {
        await this.assertHeadUnmoved(wt);
        await this.restoreInPlace(wt, target);
      } else {
        await git(wt.top, ['add', '-A']); // supaya berkas baru ikut terhapus oleh read-tree
        await git(wt.top, ['read-tree', '-u', '--reset', target]);
      }
      if (target === wt.base) {
        await git(wt.repo, ['update-ref', '-d', wt.checkpointRef]).catch(() => undefined);
      } else {
        await git(wt.repo, ['update-ref', wt.checkpointRef, target]);
      }
    });
    return this.get(runId);
  }

  /** Mengembalikan satu berkas ke keadaan di base (menolak perubahan agent pada berkas itu). */
  async revertFile(runId: string, path: string): Promise<ReviewState> {
    await this.exclusive(runId, async () => {
      const wt = this.workspace(runId);
      await this.assertIdle(runId);
      if (wt.kind === 'in_place') await this.assertHeadUnmoved(wt);
      const git = this.git(wt);
      const tree = await this.snapshot(wt);
      const names = await git(
        wt.top,
        ['diff', '--no-color', '--no-ext-diff', '--name-status', '-z', '-M', wt.base, tree],
        { raw: true },
      );
      const change = parseNameStatus(names).find((c) => c.path === path);
      if (!change) throw new ReviewError('review_not_found', 'Berkas itu tidak berubah.');

      const targets = [change.path, ...(change.oldPath ? [change.oldPath] : [])];
      for (const target of targets) {
        const inBase = await git(wt.top, ['cat-file', '-e', `${wt.base}:${target}`]).then(
          () => true,
          () => false,
        );
        if (inBase) {
          await git(wt.top, ['--literal-pathspecs', 'checkout', wt.base, '--', target]);
        } else {
          await git(wt.top, [
            '--literal-pathspecs',
            'rm',
            '-q',
            '-f',
            '--cached',
            '--ignore-unmatch',
            '--',
            target,
          ]);
          await fs.rm(nodePath.join(wt.top, target), { force: true });
        }
      }
    });
    return this.get(runId);
  }

  /**
   * Terima. `in_place`: semua perubahan menjadi satu commit langsung di branch aktif project (bila branch itu maju
   * selama run, commit ditaruh di atas HEAD terbaru; riwayat tidak pernah ditulis ulang). `worktree`: satu commit
   * di branch `aios/...`; dengan `merge`, branch itu digabung ke branch kerja pengguna SEBELUM worktree dihapus:
   * fast-forward bila bisa, bila branch pengguna sudah maju hasil run di-rebase dulu ke atasnya (bentrok = rebase
   * dibatalkan, alasan `conflict`). Working tree pengguna yang kotor atau detached tidak digabung.
   */
  async accept(
    runId: string,
    options: { merge: boolean; commitMessage?: string | undefined },
  ): Promise<ReviewOutcome> {
    const wt = this.workspace(runId);
    await this.assertIdle(runId);
    if (wt.kind === 'in_place') return this.acceptInPlace(wt, options.commitMessage);

    const outcome = await this.exclusive(runId, async (): Promise<ReviewOutcome> => {
      const git = this.git(wt);
      await git(wt.top, ['add', '-A']);
      const status = await git(wt.top, ['status', '--porcelain']);
      let commit: string | null = null;
      if (status !== '') {
        const { files } = await this.collect(wt, false);
        const message = options.commitMessage ?? this.commitMessage(runId, files);
        await git(wt.top, ['commit', '-q', '-m', message]);
        commit = await git(wt.top, ['rev-parse', 'HEAD']);
      } else if ((await git(wt.top, ['rev-parse', 'HEAD'])) !== wt.base) {
        commit = await git(wt.top, ['rev-parse', 'HEAD']);
      }
      return { branch: wt.branch, commit, merged: false, mergeSkipped: null };
    });

    if (outcome.commit === null) {
      await this.deps.worktrees.remove(runId, { deleteBranch: true });
      return { ...outcome, mergeSkipped: 'nothing_to_merge' };
    }
    const skipped = options.merge ? await this.tryMerge(wt) : null;
    await this.deps.worktrees.remove(runId, { deleteBranch: false });
    if (!options.merge) return outcome;
    if (skipped) {
      // Rebase yang berhasil sebelum merge dilewati tetap mengubah ujung branch hasil.
      const tip = await this.deps.worktrees
        .git(wt.repo, ['rev-parse', '--verify', '-q', `refs/heads/${wt.branch}`])
        .catch(() => outcome.commit);
      return { ...outcome, commit: tip ?? outcome.commit, mergeSkipped: skipped };
    }
    const merged = await this.deps.worktrees.git(wt.repo, ['rev-parse', 'HEAD']);
    // Sudah ada di branch kerja pengguna; branch sementara tidak diperlukan lagi.
    await this.deps.worktrees.git(wt.repo, ['branch', '-d', wt.branch]).catch(() => undefined);
    return { ...outcome, commit: merged, merged: true };
  }

  /**
   * Tolak. `worktree`: worktree dan branch `aios/...` dibuang. `in_place`: folder project dikembalikan ke base
   * (atau ke HEAD terbaru bila branch maju selama run: commit yang sudah ada tidak dibatalkan), berkas buatan run
   * dihapus, berkas yang diabaikan git dibiarkan, lalu catatan run dilepas. Branch pemilik tidak pernah dihapus.
   */
  async reject(runId: string): Promise<ReviewOutcome> {
    const wt = this.workspace(runId);
    await this.assertIdle(runId);
    if (wt.kind === 'in_place') {
      await this.exclusive(runId, async () => {
        const moved = await this.headMoved(wt);
        if (moved && moved.state !== 'advanced') throw this.headMovedError(wt, moved);
        await this.restoreInPlace(wt, moved ? moved.head : wt.base);
      });
    }
    await this.deps.worktrees.remove(runId, { deleteBranch: wt.kind === 'worktree' });
    return { branch: wt.branch, commit: null, merged: false, mergeSkipped: null };
  }

  private async acceptInPlace(
    wt: InPlaceWorkspace,
    commitMessage: string | undefined,
  ): Promise<ReviewOutcome> {
    const commit = await this.exclusive(wt.runId, async (): Promise<string | null> => {
      const moved = await this.headMoved(wt);
      if (moved && moved.state !== 'advanced') throw this.headMovedError(wt, moved);
      const git = this.git(wt);
      const { files } = await this.collect(wt, false);
      await git(wt.top, ['add', '-A']);
      const status = await git(wt.top, ['status', '--porcelain']);
      if (status === '') return null;
      const message = commitMessage ?? this.commitMessage(wt.runId, files);
      await git(wt.top, ['commit', '-q', '-m', message]);
      return git(wt.top, ['rev-parse', 'HEAD']);
    });
    await this.deps.worktrees.remove(wt.runId, { deleteBranch: false });
    return {
      branch: wt.branch,
      commit,
      merged: false,
      mergeSkipped: commit === null ? 'nothing_to_merge' : null,
    };
  }

  /**
   * Menggabungkan branch hasil ke branch kerja pengguna (worktree masih ada). Fast-forward bila bisa; bila branch
   * pengguna sudah maju, commit hasil di-rebase di worktree ke atas HEAD pengguna lalu fast-forward.
   */
  private async tryMerge(wt: Worktree): Promise<MergeSkipped | null> {
    const git = this.git(wt);
    const head = await git(wt.repo, ['symbolic-ref', '-q', 'HEAD']).catch(() => '');
    if (head === '') return 'detached';
    const dirty = await git(wt.repo, ['status', '--porcelain', '--untracked-files=no']);
    if (dirty !== '') return 'dirty';
    const target = await git(wt.repo, ['rev-parse', 'HEAD']);
    const fastForward = await git(wt.repo, ['merge-base', '--is-ancestor', target, wt.branch]).then(
      () => true,
      () => false,
    );
    if (!fastForward) {
      try {
        await git(wt.top, ['rebase', '-q', target]);
      } catch {
        await git(wt.top, ['rebase', '--abort']).catch(() => undefined);
        return 'conflict';
      }
    }
    try {
      await git(wt.repo, ['merge', '--ff-only', '-q', wt.branch]);
      return null;
    } catch {
      return 'not_fast_forward';
    }
  }

  /**
   * Mengembalikan folder project (in_place) tepat ke isi `target`: berkas terlacak yang berubah atau terhapus
   * diambil dari `target`, berkas baru yang tidak diabaikan git dihapus, berkas yang diabaikan git tidak disentuh.
   * Aturan abaikan yang dipakai adalah milik `target` (berkas `.gitignore` dikembalikan lebih dulu), jadi agent yang
   * mengubah `.gitignore` tidak bisa membuat node_modules ikut terhapus. Index git asli lalu disamakan dengan HEAD.
   * Semua pembacaan memakai index pribadi; index pemilik hanya disentuh di langkah terakhir.
   */
  private async restoreInPlace(wt: InPlaceWorkspace, target: string): Promise<void> {
    const git = this.git(wt);
    const gitDir = await git(wt.top, ['rev-parse', '--absolute-git-dir']);
    const env = { GIT_INDEX_FILE: this.deps.worktrees.privateIndex(wt, gitDir) };
    const changesSince = async (tree: string) =>
      parseNameStatus(
        await git(
          wt.top,
          [
            'diff',
            '--no-color',
            '--no-ext-diff',
            '--no-renames',
            '--name-status',
            '-z',
            target,
            tree,
          ],
          { raw: true },
        ),
      );
    const restore = async (change: Change) => {
      if (change.status === 'added') {
        const file = nodePath.join(wt.top, change.path);
        const stat = await fs.lstat(file).catch(() => undefined);
        // Hanya berkas atau tautan; folder (mis. submodule) tidak pernah dihapus rekursif.
        if (stat && !stat.isDirectory()) await fs.unlink(file);
        await this.pruneEmptyDirs(wt.top, nodePath.dirname(file));
      } else {
        await git(wt.top, ['--literal-pathspecs', 'checkout', target, '--', change.path], { env });
      }
    };

    // 1. Aturan abaikan dikembalikan dulu ke milik target.
    const now = await this.snapshot(wt);
    for (const change of await changesSince(now)) {
      if (nodePath.posix.basename(change.path) === '.gitignore') await restore(change);
    }
    // 2. Isi folder dibaca ulang dengan aturan target, mulai dari isi target di index pribadi.
    await git(wt.top, ['read-tree', target], { env });
    await git(wt.top, ['add', '-A'], { env });
    const tree = await git(wt.top, ['write-tree'], { env });
    for (const change of await changesSince(tree)) await restore(change);
    // 3. Index pemilik: sama dengan HEAD (perubahan yang tersisa, mis. checkpoint, tampil sebagai belum di-stage).
    await git(wt.top, ['reset', '-q']);
  }

  /** Menghapus folder kosong sisa berkas buatan run, naik sampai akar (folder berisi apa pun dibiarkan). */
  private async pruneEmptyDirs(top: string, dir: string): Promise<void> {
    for (let current = dir; current !== top && current.startsWith(top);) {
      const removed = await fs.rmdir(current).then(
        () => true,
        () => false,
      );
      if (!removed) return;
      current = nodePath.dirname(current);
    }
  }

  /** HEAD project dibanding saat run in_place dimulai; null bila tetap di branch dan commit yang sama. */
  private async headMoved(wt: InPlaceWorkspace): Promise<HeadMoved | null> {
    const git = this.git(wt);
    const branch =
      (await git(wt.top, ['symbolic-ref', '--short', '-q', 'HEAD']).catch(() => '')) || null;
    const head = await git(wt.top, ['rev-parse', 'HEAD']);
    if (branch !== wt.branch) return { state: 'switched', head, branch, commits: 0 };
    if (head === wt.base) return null;
    const ancestor = await git(wt.top, ['merge-base', '--is-ancestor', wt.base, head]).then(
      () => true,
      () => false,
    );
    if (!ancestor) return { state: 'diverged', head, branch, commits: 0 };
    const commits = Number(await git(wt.top, ['rev-list', '--count', `${wt.base}..${head}`])) || 0;
    return { state: 'advanced', head, branch, commits };
  }

  private async assertHeadUnmoved(wt: InPlaceWorkspace): Promise<void> {
    const moved = await this.headMoved(wt);
    if (moved) throw this.headMovedError(wt, moved);
  }

  private headMovedError(wt: InPlaceWorkspace, moved: HeadMoved): ReviewError {
    if (moved.state === 'switched') {
      return new ReviewError(
        'head_moved',
        `Folder project sekarang ${moved.branch ? `di branch ${moved.branch}` : 'detached HEAD'}, bukan ${wt.branch} tempat run ini bekerja. Kembali ke ${wt.branch} dulu.`,
      );
    }
    if (moved.state === 'diverged') {
      return new ReviewError(
        'head_moved',
        `Riwayat branch ${wt.branch} ditulis ulang sejak run dimulai, jadi perubahan run tidak bisa diterapkan dengan aman. Selesaikan lewat tab Git.`,
      );
    }
    return new ReviewError(
      'head_moved',
      `Branch ${wt.branch} maju ${moved.commits} commit sejak run dimulai; kembali ke checkpoint dan batalkan per berkas tidak tersedia. Terima atau tolak masih bisa.`,
    );
  }

  private commitMessage(runId: string, files: { path: string }[]): string {
    const proposal = this.deps.worktrees.proposal(runId);
    const messages = proposal
      ? [...proposal.commits, ...(proposal.commit ? [proposal.commit] : [])]
      : [];
    return (
      combineCommitMessages(messages) ??
      fallbackCommitMessage(
        proposal?.summary ?? '',
        files.map((f) => f.path),
      )
    );
  }

  private async collect(wt: Workspace, withPatch: boolean): Promise<{ files: ReviewFile[] }> {
    const git = this.git(wt);
    const tree = await this.snapshot(wt);
    const diffArgs = ['diff', '--no-color', '--no-ext-diff', '-M', '-z'];
    const names = parseNameStatus(
      await git(wt.top, [...diffArgs, '--name-status', wt.base, tree], { raw: true }),
    );
    const stats = new Map(
      parseNumstat(await git(wt.top, [...diffArgs, '--numstat', wt.base, tree], { raw: true })).map(
        (s) => [s.path, s],
      ),
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
            wt.top,
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
   * Isi folder kerja saat ini sebagai tree git, lewat index pribadi: index milik folder kerja juga dipakai git di
   * dalam omp (dan bisa terkunci) atau milik pemilik (in_place), jadi pembacaan tidak boleh menyentuhnya.
   */
  private async snapshot(wt: Workspace): Promise<string> {
    const git = this.git(wt);
    const gitDir = await git(wt.top, ['rev-parse', '--absolute-git-dir']);
    const env = { GIT_INDEX_FILE: this.deps.worktrees.privateIndex(wt, gitDir) };
    await git(wt.top, ['add', '-A'], { env });
    return git(wt.top, ['write-tree'], { env });
  }

  private async listCheckpoints(wt: Workspace): Promise<Checkpoint[]> {
    const exists = await this.git(wt)(wt.repo, [
      'rev-parse',
      '--verify',
      '-q',
      wt.checkpointRef,
    ]).catch(() => '');
    if (exists === '') return [];
    const out = await this.git(wt)(
      wt.repo,
      ['log', '--reverse', '--format=%H%x1f%s%x1f%cI', `${wt.base}..${wt.checkpointRef}`],
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

  private async resolveCheckpoint(wt: Workspace, id: string): Promise<string> {
    const known = (await this.listCheckpoints(wt)).find((c) => c.id === id);
    if (!known) throw new ReviewError('review_not_found', 'Checkpoint itu tidak ada.');
    return known.id;
  }

  private async currentBranch(wt: Workspace): Promise<string | null> {
    const name = await this.git(wt)(wt.repo, ['symbolic-ref', '--short', '-q', 'HEAD']).catch(
      () => '',
    );
    return name === '' ? null : name;
  }

  private workspace(runId: string): Workspace {
    const wt = this.deps.worktrees.get(runId);
    if (!wt || wt.planOnly) {
      throw new ReviewError(
        'review_not_found',
        'Hasil run ini sudah tidak ada di PC ini (sudah diterima, ditolak, atau tanpa perubahan).',
      );
    }
    return wt;
  }

  /**
   * `isWorking()` dan event `run.completed`/`error` yang diteruskan ke gateway seharusnya berubah serentak
   * (lihat `RunState.finished` di coordinator.ts). Retry singkat ini hanya jaring pengaman tambahan untuk sisa
   * balapan yang belum tertutup (mis. panggilan lama yang masih di tengah jalan) -- bukan pengganti perbaikan
   * urutan itu. Ditemukan nyata lewat `omp.e2e.test.ts` flaky di VPS ARM64 (REPAIR_LOG P8).
   */
  private async assertIdle(runId: string): Promise<void> {
    for (let attempt = 1; this.deps.isWorking(runId); attempt++) {
      if (attempt >= ASSERT_IDLE_RETRIES) {
        throw new ReviewError(
          'run_active',
          'Run masih berjalan. Tunggu sampai selesai atau hentikan dulu.',
        );
      }
      await new Promise((r) => setTimeout(r, ASSERT_IDLE_WAIT_MS));
    }
  }

  private git(wt: Workspace) {
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

  /** Operasi git pada satu folder kerja tidak boleh saling menyalip (index git bersama). */
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
