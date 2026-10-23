import {
  FoldersResultSchema,
  ProjectBindingSchema,
  ProjectInspectionSchema,
  ProjectsResultSchema,
  type ProjectBinding,
  type ProjectInspection,
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
  };
}

export type WorkerApi = ReturnType<typeof createWorkerApi>;
