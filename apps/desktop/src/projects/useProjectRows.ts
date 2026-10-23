import type { Project, ProjectBinding } from '@aios/contracts';
import { useBindings, useProjects, useWorker } from '../worker/hooks';

export interface ProjectRow {
  project: Project;
  /** Ikatan ke folder di PC ini; undefined bila project ini tidak terikat di sini. */
  binding: ProjectBinding | undefined;
  /** Project ini milik worker di PC ini (bukan perangkat lain). */
  mine: boolean;
}

/** Project dari server digabung dengan ikatan folder lokal dari worker. Path folder tidak pernah dari server. */
export function useProjectRows() {
  const projects = useProjects();
  const bindings = useBindings();
  const worker = useWorker();
  const myDeviceId = worker.status?.deviceId ?? null;
  const rows: ProjectRow[] = (projects.data ?? []).map((project) => ({
    project,
    binding: bindings.data?.find((b) => b.projectId === project.id),
    mine: myDeviceId !== null && project.workerDeviceId === myDeviceId,
  }));
  return { rows, projects, bindings, worker };
}
