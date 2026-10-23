import nodePath from 'node:path';
import type { LocalRequest, ProjectInspection, WorkerStatus } from '@aios/contracts';
import type { GatewayLink } from '../gateway/link.js';
import type { AllowList } from '../paths/allowlist.js';
import type { ProcessManager } from '../process/manager.js';
import type { ProjectBindings } from '../projects/bindings.js';
import { detectStack } from '../projects/detect.js';
import { detectGit } from '../projects/git.js';

export interface HandlerDeps {
  allowed: AllowList;
  bindings: ProjectBindings;
  processes: ProcessManager;
  link: GatewayLink;
  version: string;
}

export function workerStatus({ link, processes, version }: HandlerDeps): WorkerStatus {
  return {
    gateway: link.state,
    deviceId: link.deviceId,
    activeRuns: processes.activeRunIds().length,
    version,
  };
}

/** Menjalankan satu permintaan dari desktop. Galat path dilempar sebagai PathError (dipetakan oleh server). */
export function createHandler(deps: HandlerDeps): (request: LocalRequest) => Promise<unknown> {
  const { allowed, bindings, processes, link } = deps;

  return async (request) => {
    switch (request.method) {
      case 'status.get':
        return workerStatus(deps);

      case 'session.set':
        link.setSession(request.params);
        return {};

      case 'session.clear':
        link.clearSession();
        return {};

      case 'folders.list':
        return { folders: allowed.list() };

      case 'folders.add':
        await allowed.add(request.params.path);
        return { folders: allowed.list() };

      case 'folders.remove':
        await allowed.remove(request.params.path);
        return { folders: allowed.list() };

      case 'project.inspect': {
        const path = await allowed.resolveDirectory(request.params.path);
        const inspection: ProjectInspection = {
          path,
          name: nodePath.basename(path) || path,
          stack: await detectStack(path),
          git: await detectGit(processes, path),
        };
        return inspection;
      }

      case 'project.bind':
        return bindings.bind(request.params.projectId, request.params.path);

      case 'project.unbind':
        await bindings.unbind(request.params.projectId);
        return { projects: await bindings.list() };

      case 'projects.list':
        return { projects: await bindings.list() };
    }
  };
}
