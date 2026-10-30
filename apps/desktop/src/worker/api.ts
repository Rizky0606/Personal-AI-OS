import {
  FileContentSchema,
  FileListSchema,
  FileMatchesSchema,
  GitActionResultSchema,
  GitBranchesSchema,
  GitCommitSchema,
  GitDiffSchema,
  GitLogSchema,
  GitStatusSchema,
  FoldersResultSchema,
  ProjectBindingSchema,
  ProjectInspectionSchema,
  PreviewInfoSchema,
  PreviewShotSchema,
  ProjectsResultSchema,
  ProjectSetupSchema,
  ReviewStateSchema,
  TerminalInfoSchema,
  type FileContent,
  type FileList,
  type GitActionResult,
  type GitBranches,
  type GitCommit,
  type GitDiff,
  type GitLog,
  type GitStatus,
  type PreviewInfo,
  type PreviewShot,
  type PreviewTarget,
  type ProjectBinding,
  type ProjectSetup,
  type ProjectInspection,
  type ReviewState,
  type TerminalInfo,
} from '@aios/contracts';

export type WorkerCall = (method: string, params?: object) => Promise<unknown>;

/** Perintah ke worker lokal dengan hasil yang divalidasi kontrak. */
export function createWorkerApi(call: WorkerCall) {
  return {
    folders: async (): Promise<string[]> =>
      FoldersResultSchema.parse(await call('folders.list')).folders,
    addFolder: async (path: string): Promise<string[]> =>
      FoldersResultSchema.parse(await call('folders.add', { path })).folders,
    removeFolder: async (path: string): Promise<string[]> =>
      FoldersResultSchema.parse(await call('folders.remove', { path })).folders,
    inspect: async (path: string): Promise<ProjectInspection> =>
      ProjectInspectionSchema.parse(await call('project.inspect', { path })),
    bind: async (projectId: string, path: string): Promise<ProjectBinding> =>
      ProjectBindingSchema.parse(await call('project.bind', { projectId, path })),
    /** Melepas ikatan project dari folder di PC ini; berkas di folder tidak disentuh. */
    unbind: async (projectId: string): Promise<ProjectBinding[]> =>
      ProjectsResultSchema.parse(await call('project.unbind', { projectId })).projects,
    bindings: async (): Promise<ProjectBinding[]> =>
      ProjectsResultSchema.parse(await call('projects.list')).projects,
    /** Penyiapan worktree baru project ini di PC ini (perintah dan tautan node_modules). */
    setupGet: async (projectId: string): Promise<ProjectSetup> =>
      ProjectSetupSchema.parse(await call('setup.get', { projectId })),
    setupSet: async (projectId: string, setup: ProjectSetup): Promise<ProjectSetup> =>
      ProjectSetupSchema.parse(await call('setup.set', { projectId, ...setup })),
    /** Diff worktree terhadap base, checkpoint, dan pesan commit usulan agent. */
    reviewGet: async (runId: string): Promise<ReviewState> =>
      ReviewStateSchema.parse(await call('review.get', { runId })),
    /** `base` = sebelum langkah pertama agent; selain itu id checkpoint. */
    reviewUndo: async (runId: string, checkpointId: string): Promise<ReviewState> =>
      ReviewStateSchema.parse(await call('review.undo', { runId, checkpointId })),
    /** Membuka (atau melanjutkan) terminal project atau worktree run; mengembalikan riwayat keluarannya. */
    terminalOpen: async (
      target: PreviewTarget & { cols: number; rows: number },
    ): Promise<TerminalInfo> => TerminalInfoSchema.parse(await call('terminal.open', target)),
    terminalWrite: async (terminalId: string, data: string): Promise<void> => {
      await call('terminal.write', { terminalId, data });
    },
    terminalResize: async (terminalId: string, cols: number, rows: number): Promise<void> => {
      await call('terminal.resize', { terminalId, cols, rows });
    },
    terminalClose: async (terminalId: string): Promise<void> => {
      await call('terminal.close', { terminalId });
    },
    /** Menjalankan dev server (menunggu siap atau gagal; bisa puluhan detik). */
    previewStart: async (target: PreviewTarget): Promise<PreviewInfo> =>
      PreviewInfoSchema.parse(await call('preview.start', target)),
    previewGet: async (target: PreviewTarget): Promise<PreviewInfo | null> => {
      const result = await call('preview.get', target);
      return result === null ? null : PreviewInfoSchema.parse(result);
    },
    previewStop: async (target: PreviewTarget): Promise<void> => {
      await call('preview.stop', target);
    },
    /** Tangkapan satu elemen (atau viewport) dari preview yang berjalan. */
    previewShot: async (
      target: PreviewTarget & { selector?: string; width?: number; height?: number },
    ): Promise<PreviewShot> => PreviewShotSchema.parse(await call('preview.shot', target)),
    /** Isi folder project (atau worktree run); `path` relatif, kosong = akar. Hanya baca. */
    filesList: async (target: PreviewTarget, path: string): Promise<FileList> =>
      FileListSchema.parse(await call('files.list', { ...target, path })),
    filesRead: async (target: PreviewTarget, path: string): Promise<FileContent> =>
      FileContentSchema.parse(await call('files.read', { ...target, path })),
    /** Pencarian nama berkas longgar (quick-open); maks 30 hasil. */
    filesFind: async (target: PreviewTarget, query: string): Promise<string[]> =>
      FileMatchesSchema.parse(await call('files.find', { ...target, query })).paths,
    /** Status git folder project (atau worktree run): branch, ahead/behind, berkas yang berubah. Hanya baca. */
    gitStatus: async (target: PreviewTarget): Promise<GitStatus> =>
      GitStatusSchema.parse(await call('git.status', target)),
    /** Perubahan satu berkas terhadap HEAD (unified diff). */
    gitDiff: async (target: PreviewTarget, path: string): Promise<GitDiff> =>
      GitDiffSchema.parse(await call('git.diff', { ...target, path })),
    gitLog: async (target: PreviewTarget, limit = 20): Promise<GitLog> =>
      GitLogSchema.parse(await call('git.log', { ...target, limit })),
    /** Aksi git di folder project (tidak pernah force). Galat git datang sebagai WorkerCallError `git_failed`. */
    gitStage: async (projectId: string, paths: string[], all = false): Promise<GitActionResult> =>
      GitActionResultSchema.parse(await call('git.stage', { projectId, paths, all })),
    gitUnstage: async (projectId: string, paths: string[], all = false): Promise<GitActionResult> =>
      GitActionResultSchema.parse(await call('git.unstage', { projectId, paths, all })),
    /** Membuang perubahan satu berkas; tidak bisa dibatalkan. */
    gitDiscard: async (projectId: string, path: string): Promise<GitActionResult> =>
      GitActionResultSchema.parse(await call('git.discard', { projectId, path })),
    gitCommit: async (projectId: string, message: string): Promise<GitCommit> =>
      GitCommitSchema.parse(await call('git.commit', { projectId, message })),
    gitBranches: async (projectId: string): Promise<GitBranches> =>
      GitBranchesSchema.parse(await call('git.branches', { projectId })),
    gitCheckout: async (projectId: string, branch: string): Promise<GitActionResult> =>
      GitActionResultSchema.parse(await call('git.checkout', { projectId, branch })),
    gitPull: async (projectId: string): Promise<GitActionResult> =>
      GitActionResultSchema.parse(await call('git.pull', { projectId })),
    gitPush: async (projectId: string): Promise<GitActionResult> =>
      GitActionResultSchema.parse(await call('git.push', { projectId })),
    reviewRevertFile: async (runId: string, path: string): Promise<ReviewState> =>
      ReviewStateSchema.parse(await call('review.revertFile', { runId, path })),
  };
}

export type WorkerApi = ReturnType<typeof createWorkerApi>;
