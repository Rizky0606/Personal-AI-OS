import { unlinkNodeModules } from '../preview/nodemodules.js';
import { promises as fs } from 'node:fs';
import nodePath from 'node:path';
import { WORKER_BRANCH_PREFIX, workerBranchFor } from '@aios/contracts';
import { z } from 'zod';
import type { AllowList } from '../paths/allowlist.js';
import { isInside } from '../paths/normalize.js';
import type { ProcessManager } from '../process/manager.js';

export class WorktreeError extends Error {
  constructor(
    readonly code:
      | 'not_a_repo'
      | 'no_commits'
      | 'worktree_failed'
      | 'workspace_detached'
      | 'workspace_dirty'
      | 'workspace_busy',
    message: string,
  ) {
    super(message);
    this.name = 'WorktreeError';
  }
}

interface WorkspaceCommon {
  runId: string;
  projectId: string;
  /** Akar repo git asli dari project. */
  repo: string;
  /** Akar folder kerja git tempat status, diff, dan commit dijalankan: folder worktree, atau repo asli. */
  top: string;
  /** Folder kerja agent: sama dengan project, di dalam `top`. */
  cwd: string;
  /** Branch tempat perubahan berada: `aios/<id pendek>` (worktree) atau branch aktif project (in_place). */
  branch: string;
  /** Commit dasar: HEAD repo saat run pertama dimulai. Diff selalu terhadap titik ini. */
  base: string;
  /** Ref tersembunyi rantai checkpoint, dikunci per id run pertama (tetap sama saat run lanjutan mengambil alih). */
  checkpointRef: string;
  /** Run mode rencana: hanya membaca, tidak pernah ditinjau, dan tidak memegang kunci repo. */
  planOnly: boolean;
}

/** Worktree git terpisah milik worker; `worktreeDir` adalah satu-satunya folder yang boleh dihapus worker. */
export interface Worktree extends WorkspaceCommon {
  kind: 'worktree';
  worktreeDir: string;
}

/**
 * Run langsung di folder project pada branch aktif. Sengaja TIDAK punya folder yang bisa dihapus: pembersihan
 * hanya melepas catatan, ref checkpoint, dan index pribadi; folder project dan branch pemilik tidak pernah dihapus.
 */
export interface InPlaceWorkspace extends WorkspaceCommon {
  kind: 'in_place';
}

export type Workspace = Worktree | InPlaceWorkspace;

/** `running`: mesin masih bekerja. `review`: menunggu keputusan pemilik. `stale`: berhenti tanpa bisa ditinjau. */
export type WorkspaceState = 'running' | 'review' | 'stale';

const COMMON = {
  runId: z.string().min(1),
  projectId: z.string(),
  repo: z.string().min(1),
  top: z.string().min(1),
  cwd: z.string().min(1),
  branch: z.string().min(1),
  base: z.string().min(1),
  checkpointRef: z.string().startsWith('refs/aios/cp/'),
  planOnly: z.boolean(),
  state: z.enum(['running', 'review', 'stale']),
};
const RegistrySchema = z.object({
  version: z.literal(1),
  items: z.array(
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('worktree'), worktreeDir: z.string().min(1), ...COMMON }),
      z.object({ kind: z.literal('in_place'), ...COMMON }),
    ]),
  ),
});

/** Ref checkpoint satu run: per id run, tidak pernah diturunkan dari nama branch. */
export const checkpointRefFor = (runId: string): string => `refs/aios/cp/${runId}`;

/** Perintah git agent yang memindahkan HEAD atau branch; ditolak worker di mode in_place. */
const REF_CHANGING_GIT =
  /(?:^|[\s;&|(`])git(?:\s+-[cC]\s+\S+)*\s+(?:commit|checkout|switch|reset|stash|rebase|merge|pull|cherry-pick|revert|am|update-ref)\b/;

/** Perintah agent ini akan memindahkan HEAD atau branch pemilik (mode in_place menolaknya). */
export function movesHead(command: string): boolean {
  return REF_CHANGING_GIT.test(command);
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
 * Folder kerja run coding (ARCHITECTURE.md, "Alur utama: run coding"), dua mode:
 * - `in_place` (bawaan run chat project): agent bekerja langsung di folder project pada branch yang sedang aktif.
 *   Hanya dibuka bila tidak detached, folder bersih, dan tidak ada run lain di repo itu (kunci per repo di sini).
 * - `worktree`: folder terpisah pada branch `aios/<id pendek>`, jadi branch dan file kerja pengguna tidak disentuh
 *   sampai hasilnya diterima. Lokasi: `.aios-worktrees` di samping repo bila folder itu masih di dalam folder yang
 *   diizinkan; kalau tidak, di folder data worker. Dua-duanya di luar repo kerja.
 * Catatan folder kerja disimpan di `workspaces.json` supaya hasil yang menunggu tinjauan bertahan saat worker
 * dimulai ulang, dan sisa run yang terputus bisa dibereskan.
 */
export class WorktreeManager {
  private readonly active = new Map<string, Workspace>();
  private readonly states = new Map<string, WorkspaceState>();
  private readonly removing = new Set<string>();
  /**
   * Run in_place yang sudah meminta izin menulis (berkas atau perintah selain baca saja). Run in_place tanpa
   * izin tulis adalah pembaca dan tidak mengunci repo (uji project 4f).
   */
  private readonly writers = new Set<string>();
  /**
   * Pembaca yang berjalan bersamaan dengan penulis lain di repo yang sama: perubahan di folder itu milik penulis,
   * jadi pembaca ini tidak membuat checkpoint/diff dan dilepas tanpa tinjauan.
   */
  private readonly bystanders = new Set<string>();
  /** Pembukaan folder kerja diurutkan: dua run tidak bisa lolos pemeriksaan kunci repo bersamaan. */
  private opening: Promise<unknown> = Promise.resolve();
  private saving: Promise<unknown> = Promise.resolve();
  private readonly registryFile: string;

  constructor(
    private readonly deps: {
      processes: ProcessManager;
      allowed: AllowList;
      /** Folder data worker; dipakai bila `.aios-worktrees` di samping repo di luar folder izin. */
      dataDir: string;
      log?: (message: string) => void;
    },
  ) {
    this.registryFile = nodePath.join(deps.dataDir, 'workspaces.json');
  }

  /** Path ini ada di dalam worktree milik worker? Dipakai pemeriksaan cwd proses anak (bukan folder project). */
  contains(path: string): boolean {
    return [...this.active.values()].some(
      (w) => w.kind === 'worktree' && isInside(w.worktreeDir, path),
    );
  }

  get(runId: string): Workspace | undefined {
    return this.active.get(runId);
  }

  state(runId: string): WorkspaceState | undefined {
    return this.states.get(runId);
  }

  /** Run in_place (bukan mode rencana) yang menunggu keputusan dan tidak sedang dikerjakan mesin. */
  pendingInPlace(): InPlaceWorkspace[] {
    return [...this.active.values()].filter(
      (w): w is InPlaceWorkspace =>
        w.kind === 'in_place' && !w.planOnly && this.states.get(w.runId) !== 'running',
    );
  }

  /** Worktree baru di branch `aios/<id pendek>` dari HEAD repo saat ini. */
  async create(
    runId: string,
    projectPath: string,
    options: { projectId?: string; planOnly?: boolean } = {},
  ): Promise<Worktree> {
    return this.serially(async () => {
      const { repoRoot, base } = await this.repoOf(projectPath);
      const branch = workerBranchFor(runId);
      const worktreeDir = await this.chooseRoot(repoRoot, branch);
      await fs.mkdir(nodePath.dirname(worktreeDir), { recursive: true });
      await this.git(repoRoot, ['worktree', 'add', '-b', branch, worktreeDir, base]).catch(
        (error: unknown) => {
          throw new WorktreeError('worktree_failed', `Worktree gagal dibuat: ${message(error)}`);
        },
      );

      const real = await fs.realpath(worktreeDir);
      const relative = nodePath.relative(repoRoot, await fs.realpath(projectPath));
      const worktree: Worktree = {
        kind: 'worktree',
        runId,
        projectId: options.projectId ?? '',
        repo: repoRoot,
        top: real,
        worktreeDir: real,
        cwd: relative === '' ? real : nodePath.join(real, relative),
        branch,
        base,
        checkpointRef: checkpointRefFor(runId),
        planOnly: options.planOnly === true,
      };
      this.track(worktree, 'running');
      await this.persist();
      return worktree;
    });
  }

  /**
   * Run langsung di folder project, di branch aktif. Ditolak bila detached HEAD, bila folder punya perubahan yang
   * belum di-commit (berkas terlacak atau berkas baru yang tidak diabaikan git), atau bila repo yang sama dipegang
   * run lain: run in_place yang sudah meminta izin tulis, run worktree yang berjalan, atau hasil in_place yang
   * belum ditinjau. Run in_place yang hanya membaca tidak memegang kunci; begitu ia meminta izin tulis
   * (`claimWrite`) ia menjadi penulis, kecuali repo itu sudah punya penulis lain. Mode rencana hanya membaca, jadi
   * tidak diperiksa kebersihannya.
   */
  async openInPlace(
    runId: string,
    projectPath: string,
    options: { projectId?: string; planOnly?: boolean } = {},
  ): Promise<InPlaceWorkspace> {
    return this.serially(async () => {
      const planOnly = options.planOnly === true;
      const { repoRoot, base } = await this.repoOf(projectPath);
      const branch = await this.git(repoRoot, ['symbolic-ref', '--short', '-q', 'HEAD']).catch(
        () => '',
      );
      if (branch === '') {
        throw new WorktreeError(
          'workspace_detached',
          'Folder project sedang detached HEAD (tidak di branch mana pun). Pindah ke sebuah branch dulu, atau jalankan sekali ini di worktree terpisah.',
        );
      }
      if (!planOnly) {
        this.assertNotBusy(runId, repoRoot);
        const dirty = await this.git(repoRoot, ['status', '--porcelain']);
        if (dirty !== '') {
          const count = dirty.split('\n').filter(Boolean).length;
          throw new WorktreeError(
            'workspace_dirty',
            `Folder project punya ${count} perubahan yang belum di-commit. Commit atau stash dulu, atau jalankan sekali ini di worktree terpisah.`,
          );
        }
      }
      const workspace: InPlaceWorkspace = {
        kind: 'in_place',
        runId,
        projectId: options.projectId ?? '',
        repo: repoRoot,
        top: repoRoot,
        cwd: await fs.realpath(projectPath),
        branch,
        base,
        checkpointRef: checkpointRefFor(runId),
        planOnly,
      };
      this.track(workspace, 'running');
      await this.persist();
      return workspace;
    });
  }

  /** Kunci repo untuk run in_place baru (lihat openInPlace). */
  private assertNotBusy(runId: string, repoRoot: string): void {
    for (const other of this.active.values()) {
      if (other.runId === runId || other.repo !== repoRoot || other.planOnly) continue;
      const running = this.states.get(other.runId) === 'running';
      if (other.kind === 'in_place' && !running) {
        throw new WorktreeError(
          'workspace_busy',
          'Hasil run sebelumnya di folder project ini masih menunggu tinjauan. Terima atau tolak dulu, atau jalankan sekali ini di worktree terpisah.',
        );
      }
      if (running && (other.kind === 'worktree' || this.writers.has(other.runId))) {
        throw new WorktreeError(
          'workspace_busy',
          'Ada run lain yang sedang berjalan di repo ini. Tunggu sampai selesai, atau jalankan sekali ini di worktree terpisah.',
        );
      }
    }
  }

  /**
   * Run meminta izin yang bisa mengubah berkas. Sinkron (tanpa await), jadi tidak bisa berselang dengan
   * pemeriksaan kunci di openInPlace. Run in_place menjadi penulis bila repo-nya tidak punya penulis lain (run
   * in_place lain yang sudah menulis atau hasil yang menunggu tinjauan); false berarti izin itu harus ditolak.
   * Worktree selalu boleh: foldernya milik run itu sendiri.
   */
  claimWrite(runId: string): boolean {
    const ws = this.active.get(runId);
    if (ws?.kind !== 'in_place' || this.writers.has(runId)) return true;
    // Pernah berbagi folder dengan penulis lain: base-nya tidak lagi mewakili isi folder, jadi tetap pembaca.
    if (this.bystanders.has(runId)) return false;
    const readers: string[] = [];
    for (const other of this.active.values()) {
      if (other.runId === runId || other.repo !== ws.repo || other.planOnly) continue;
      if (other.kind !== 'in_place') continue;
      if (this.writers.has(other.runId) || this.states.get(other.runId) !== 'running') return false;
      readers.push(other.runId);
    }
    this.writers.add(runId);
    for (const reader of readers) this.bystanders.add(reader);
    return true;
  }

  /**
   * Pembaca in_place yang pernah berjalan bersamaan dengan penulis lain di repo yang sama. Ia tidak pernah
   * mendapat izin tulis, jadi perubahan di folder itu bukan miliknya: tanpa checkpoint, diff, atau tinjauan.
   */
  isBystander(runId: string): boolean {
    return this.bystanders.has(runId);
  }

  /** Menyimpan perubahan agent sebagai satu commit di branch kerja `aios/...` (hanya worktree). */
  async commitAll(runId: string, commitMessage: string): Promise<boolean> {
    const wt = this.active.get(runId);
    if (wt?.kind !== 'worktree') return false;
    await this.git(wt.top, ['add', '-A']);
    const status = await this.git(wt.top, ['status', '--porcelain']);
    if (status === '') return false;
    await this.git(wt.top, ['commit', '-q', '-m', commitMessage]);
    return true;
  }

  /** Tidak ada perubahan sama sekali: tidak ada berkas berubah dan tidak ada commit baru. */
  async isPristine(runId: string): Promise<boolean> {
    const ws = this.active.get(runId);
    if (!ws) return false;
    try {
      const status = await this.git(ws.top, ['status', '--porcelain']);
      const head = await this.git(ws.top, ['rev-parse', 'HEAD']);
      return status === '' && head === ws.base;
    } catch {
      return false;
    }
  }

  /**
   * Run lanjutan (revisi atau pesan lanjutan) memakai folder kerja run sebelumnya, apa pun modenya: entri
   * dipindahkan ke id run baru. Branch, base, dan ref checkpoint tetap, jadi diff selalu terhadap titik awal.
   */
  async adopt(fromRunId: string, toRunId: string): Promise<Workspace> {
    return this.serially(async () => {
      const ws = this.active.get(fromRunId);
      if (!ws || this.removing.has(fromRunId)) {
        throw new WorktreeError(
          'worktree_failed',
          'Folder kerja run sebelumnya sudah tidak ada (hasilnya sudah diterima atau dibuang).',
        );
      }
      const next: Workspace = { ...ws, runId: toRunId };
      this.active.delete(fromRunId);
      this.states.delete(fromRunId);
      // Run lanjutan mewarisi perubahan yang menunggu tinjauan: ia penulis sejak awal.
      this.writers.delete(fromRunId);
      this.bystanders.delete(fromRunId);
      if (next.kind === 'in_place' && !next.planOnly) this.writers.add(toRunId);
      this.track(next, 'running');
      await this.persist();
      return next;
    });
  }

  /** Mesin berhenti: `review` bila hasilnya menunggu keputusan, `stale` bila tidak bisa ditinjau. */
  async setState(runId: string, state: WorkspaceState): Promise<void> {
    if (!this.active.has(runId)) return;
    this.states.set(runId, state);
    await this.persist();
  }

  /**
   * Melepas folder kerja satu run. Worktree: foldernya dihapus (hanya di lokasi milik worker), `deleteBranch`
   * juga menghapus branch `aios/...`-nya. In_place: hanya catatan, ref checkpoint, dan index pribadi yang
   * dilepas; folder project dan branch pemilik tidak pernah disentuh, apa pun nilai `deleteBranch`.
   */
  async remove(runId: string, { deleteBranch }: { deleteBranch: boolean }): Promise<void> {
    const ws = this.active.get(runId);
    if (!ws || this.removing.has(runId)) return;
    this.removing.add(runId);
    try {
      if (ws.kind === 'worktree') await this.removeWorktree(ws, deleteBranch);
      else await this.releaseInPlace(ws);
    } finally {
      // Dilepas setelah selesai: yang melihat folder kerja hilang boleh yakin pembersihannya tuntas.
      this.active.delete(runId);
      this.states.delete(runId);
      this.writers.delete(runId);
      this.bystanders.delete(runId);
      this.removing.delete(runId);
      await this.persist().catch(() => undefined);
    }
  }

  /** Index pribadi untuk membaca isi folder kerja tanpa menyentuh index git yang dipakai agent atau pemilik. */
  privateIndex(ws: Workspace, gitDir: string): string {
    return nodePath.join(
      gitDir,
      ws.kind === 'in_place'
        ? `aios-index-${ws.checkpointRef.slice('refs/aios/cp/'.length)}`
        : 'aios-index',
    );
  }

  /**
   * Dipanggil sekali saat worker mulai, sebelum run apa pun. Catatan `workspaces.json` dimuat: hasil yang menunggu
   * tinjauan dipulihkan (in_place selalu, karena perubahannya ada di folder project); worktree dari run yang
   * terputus atau berhenti tanpa bisa ditinjau dihapus. Worktree `aios/*` sisa versi lama (tanpa catatan) di lokasi
   * milik worker juga dihapus. Branch hanya dihapus bila isinya juga ada di branch lain, jadi tidak ada commit hilang.
   * Mengembalikan id run in_place yang dipulihkan.
   */
  async recover(projectPaths: readonly string[]): Promise<string[]> {
    let items: z.infer<typeof RegistrySchema>['items'] = [];
    try {
      const parsed = RegistrySchema.safeParse(
        JSON.parse(await fs.readFile(this.registryFile, 'utf8')),
      );
      if (parsed.success) items = parsed.data.items;
      else this.deps.log?.('workspaces.json tidak valid; diabaikan');
    } catch {
      items = [];
    }

    const restored: string[] = [];
    const repos = new Set<string>();
    for (const item of items) {
      const { state, ...ws } = item;
      repos.add(ws.repo);
      if (ws.kind === 'in_place') {
        if (ws.planOnly) continue;
        // Folder project sudah bersih dan HEAD tetap: tidak ada yang perlu ditinjau.
        this.track(ws, 'review');
        if (await this.isPristine(ws.runId)) {
          await this.releaseInPlace(ws).catch(() => undefined);
          this.active.delete(ws.runId);
          this.states.delete(ws.runId);
          continue;
        }
        restored.push(ws.runId);
        continue;
      }
      const dirExists = await fs.stat(ws.worktreeDir).then(
        () => true,
        () => false,
      );
      if (state === 'review' && !ws.planOnly && dirExists) {
        this.track(ws, 'review');
        continue;
      }
      await this.removeWorktree(ws, true, { keepUniqueCommits: true }).catch((error: unknown) =>
        this.deps.log?.(`worktree sisa ${ws.worktreeDir} gagal dibersihkan: ${message(error)}`),
      );
    }

    for (const path of projectPaths) {
      const repo = await this.git(path, ['rev-parse', '--show-toplevel'])
        .then((r) => fs.realpath(r))
        .catch(() => undefined);
      if (repo) repos.add(repo);
    }
    for (const repo of repos) {
      await this.removeLegacyOrphans(repo).catch((error: unknown) =>
        this.deps.log?.(`worktree sisa di ${repo} gagal diperiksa: ${message(error)}`),
      );
    }
    await this.persist();
    return restored;
  }

  /** Worktree `aios/*` di lokasi milik worker yang tidak tercatat sebagai folder kerja aktif. */
  private async removeLegacyOrphans(repo: string): Promise<void> {
    const list = await this.git(repo, ['worktree', 'list', '--porcelain']);
    const known = new Set(
      [...this.active.values()].flatMap((w) => (w.kind === 'worktree' ? [w.worktreeDir] : [])),
    );
    for (const block of list.split(/\n\n+/)) {
      const dir = /^worktree (.+)$/m.exec(block)?.[1];
      const ref = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1];
      if (!dir || !ref?.startsWith(WORKER_BRANCH_PREFIX)) continue;
      const real = await fs.realpath(dir).catch(() => dir);
      if (known.has(real) || !this.isManagedDir(real, repo)) continue;
      const orphan: Worktree = {
        kind: 'worktree',
        runId: '',
        projectId: '',
        repo,
        top: real,
        worktreeDir: real,
        cwd: real,
        branch: ref,
        base: '',
        checkpointRef: `refs/aios/cp/${ref.slice(WORKER_BRANCH_PREFIX.length)}`,
        planOnly: false,
      };
      this.deps.log?.(`worktree sisa ${real} (${ref}) dibersihkan`);
      await this.removeWorktree(orphan, true, { keepUniqueCommits: true });
    }
    await this.git(repo, ['worktree', 'prune']).catch(() => undefined);
  }

  /**
   * Menghapus satu worktree milik worker. Hanya menerima `Worktree` (folder in_place tidak punya `worktreeDir`), dan
   * sebelum menghapus apa pun memastikan foldernya di lokasi worktree milik worker, bukan repo atau induknya.
   */
  private async removeWorktree(
    wt: Worktree,
    deleteBranch: boolean,
    options: { keepUniqueCommits?: boolean } = {},
  ): Promise<void> {
    this.assertManaged(wt);
    // Tautan node_modules dari preview dilepas dulu agar penghapusan tidak menembus ke folder asli.
    await unlinkNodeModules(wt.worktreeDir).catch(() => undefined);
    await unlinkNodeModules(wt.cwd).catch(() => undefined);
    await this.git(wt.repo, ['worktree', 'remove', '--force', wt.worktreeDir]).catch(
      () => undefined,
    );
    await fs.rm(wt.worktreeDir, { recursive: true, force: true }).catch(() => undefined);
    await this.git(wt.repo, ['worktree', 'prune']).catch(() => undefined);
    await this.git(wt.repo, ['update-ref', '-d', wt.checkpointRef]).catch(() => undefined);
    if (!deleteBranch) return;
    if (options.keepUniqueCommits && !(await this.containedElsewhere(wt.repo, wt.branch))) {
      this.deps.log?.(`branch ${wt.branch} punya commit yang tidak ada di branch lain; dibiarkan`);
      return;
    }
    await this.git(wt.repo, ['branch', '-D', wt.branch]).catch(() => undefined);
  }

  /** In_place: hanya ref checkpoint dan index pribadi run ini. Tidak ada `fs.rm` folder, tidak ada `branch -D`. */
  private async releaseInPlace(ws: InPlaceWorkspace): Promise<void> {
    await this.git(ws.repo, ['update-ref', '-d', ws.checkpointRef]).catch(() => undefined);
    const gitDir = await this.git(ws.repo, ['rev-parse', '--absolute-git-dir']).catch(() => '');
    if (gitDir === '') return;
    const index = this.privateIndex(ws, gitDir);
    // Satu berkas milik worker di dalam .git, bukan folder: unlink, bukan rm rekursif.
    await fs.unlink(index).catch(() => undefined);
  }

  /** Commit ujung branch ini juga ada di branch lokal lain (menghapusnya tidak menghilangkan commit apa pun). */
  private async containedElsewhere(repo: string, branch: string): Promise<boolean> {
    const tip = await this.git(repo, ['rev-parse', '--verify', '-q', `refs/heads/${branch}`]).catch(
      () => '',
    );
    if (tip === '') return true;
    const holders = await this.git(repo, [
      'for-each-ref',
      '--format=%(refname)',
      '--contains',
      tip,
      'refs/heads/',
    ]).catch(() => '');
    return holders.split('\n').some((ref) => ref !== '' && ref !== `refs/heads/${branch}`);
  }

  /**
   * Penjaga terakhir sebelum penghapusan rekursif: folder harus tepat satu tingkat di bawah `.aios-worktrees` di
   * samping repo atau `<data worker>/worktrees`, bukan repo itu sendiri dan bukan induknya, dan branch-nya `aios/*`.
   */
  private assertManaged(wt: Worktree): void {
    if (
      !wt.branch.startsWith(WORKER_BRANCH_PREFIX) ||
      !this.isManagedDir(wt.worktreeDir, wt.repo)
    ) {
      throw new Error(`menolak menghapus folder di luar lokasi worktree worker: ${wt.worktreeDir}`);
    }
  }

  private isManagedDir(dir: string, repo: string): boolean {
    if (isInside(dir, repo)) return false; // folder itu repo atau induknya
    const parent = nodePath.dirname(dir);
    const managed = [
      nodePath.join(nodePath.dirname(repo), WORKTREES_DIR),
      nodePath.join(this.deps.dataDir, 'worktrees'),
    ];
    return managed.some((m) => nodePath.relative(m, parent) === '');
  }

  private track(ws: Workspace, state: WorkspaceState): void {
    this.active.set(ws.runId, ws);
    this.states.set(ws.runId, state);
  }

  private async repoOf(projectPath: string): Promise<{ repoRoot: string; base: string }> {
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
    return { repoRoot, base };
  }

  private serially<T>(task: () => Promise<T>): Promise<T> {
    const next = this.opening.then(task, task);
    this.opening = next.catch(() => undefined);
    return next;
  }

  /** Menulis catatan folder kerja (berurutan, lewat berkas sementara lalu rename). */
  private persist(): Promise<void> {
    const write = async () => {
      const items = [...this.active.values()].map((ws) => ({
        ...ws,
        state: this.states.get(ws.runId) ?? 'running',
      }));
      await fs.mkdir(nodePath.dirname(this.registryFile), { recursive: true });
      const temp = `${this.registryFile}.tmp`;
      await fs.writeFile(temp, JSON.stringify({ version: 1, items }, null, 2));
      await fs.rename(temp, this.registryFile);
    };
    const next = this.saving.then(write, write);
    this.saving = next.catch(() => undefined);
    return next;
  }

  private async chooseRoot(repoRoot: string, branch: string): Promise<string> {
    const name = `${nodePath.basename(repoRoot)}-${branch.slice(WORKER_BRANCH_PREFIX.length)}`;
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
