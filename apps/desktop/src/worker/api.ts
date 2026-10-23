import {
  FoldersResultSchema,
  ProjectBindingSchema,
  ProjectInspectionSchema,
  ProjectsResultSchema,
  ReviewStateSchema,
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
    reviewRevertFile: async (runId: string, path: string): Promise<ReviewState> =>
      ReviewStateSchema.parse(await call('review.revertFile', { runId, path })),
  };
}

export type WorkerApi = ReturnType<typeof createWorkerApi>;
