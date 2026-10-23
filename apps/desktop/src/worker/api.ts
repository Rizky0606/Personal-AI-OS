import {
  FoldersResultSchema,
  ProjectBindingSchema,
  ProjectInspectionSchema,
  PreviewInfoSchema,
  PreviewShotSchema,
  ProjectsResultSchema,
  ReviewStateSchema,
  type PreviewInfo,
  type PreviewShot,
  type PreviewTarget,
  type ProjectBinding,
  type ProjectInspection,
  type ReviewState,
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
    bindings: async (): Promise<ProjectBinding[]> =>
      ProjectsResultSchema.parse(await call('projects.list')).projects,
    /** Diff worktree terhadap base, checkpoint, dan pesan commit usulan agent. */
    reviewGet: async (runId: string): Promise<ReviewState> =>
      ReviewStateSchema.parse(await call('review.get', { runId })),
    /** `base` = sebelum langkah pertama agent; selain itu id checkpoint. */
    reviewUndo: async (runId: string, checkpointId: string): Promise<ReviewState> =>
      ReviewStateSchema.parse(await call('review.undo', { runId, checkpointId })),
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
    reviewRevertFile: async (runId: string, path: string): Promise<ReviewState> =>
      ReviewStateSchema.parse(await call('review.revertFile', { runId, path })),
  };
}

export type WorkerApi = ReturnType<typeof createWorkerApi>;
