import nodePath from 'node:path';
import type { LocalRequest, ProjectInspection, WorkerStatus } from '@aios/contracts';
import type { GatewayLink } from '../gateway/link.js';
import type { AllowList } from '../paths/allowlist.js';
import type { ProcessManager } from '../process/manager.js';
import type { ProjectBindings } from '../projects/bindings.js';
import { detectStack } from '../projects/detect.js';
import { detectGit } from '../projects/git.js';
import type { PreviewService } from '../preview/service.js';
import { PreviewError } from '../preview/service.js';
import type { ReviewService } from '../runs/review.js';
import type { WorktreeManager } from '../runs/worktree.js';

export interface HandlerDeps {
  allowed: AllowList;
  bindings: ProjectBindings;
  processes: ProcessManager;
  link: GatewayLink;
  review: ReviewService;
  preview: PreviewService;
  worktrees: WorktreeManager;
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
  const { allowed, bindings, processes, link, review, preview, worktrees } = deps;

  /** Folder tempat preview berjalan: worktree run bila runId diisi, selain itu folder project. */
  const resolvePreview = async (target: { projectId: string; runId?: string | undefined }) => {
    const projectPath = await bindings.pathFor(target.projectId);
    if (projectPath === undefined) {
      throw new PreviewError(
        'preview_unavailable',
        'Project ini belum terikat ke folder di PC ini.',
      );
    }
    if (!target.runId) return { cwd: projectPath, projectPath };
    const worktree = worktrees.get(target.runId);
    if (!worktree) {
      throw new PreviewError(
        'preview_unavailable',
        'Worktree run ini sudah tidak ada. Preview hanya tersedia sebelum hasil diterima atau ditolak.',
      );
    }
    return { cwd: worktree.cwd, projectPath };
  };

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

      case 'review.get':
        return review.get(request.params.runId);

      case 'review.undo':
        return review.undo(request.params.runId, request.params.checkpointId);

      case 'review.revertFile':
        return review.revertFile(request.params.runId, request.params.path);

      case 'preview.start': {
        // Dicek dulu supaya galat "belum terikat" sampai ke desktop sebagai galat, bukan preview gagal.
        await resolvePreview(request.params);
        return preview.start(request.params);
      }

      case 'preview.get':
        return preview.get(request.params) ?? null;

      case 'preview.stop':
        await preview.stop(request.params);
        return {};

      case 'preview.shot': {
        const { selector, width, height, ...target } = request.params;
        const shot = await preview.shot(target, { selector, width, height });
        return { png: shot.png.toString('base64'), width: shot.width, height: shot.height };
      }
    }
  };
}
