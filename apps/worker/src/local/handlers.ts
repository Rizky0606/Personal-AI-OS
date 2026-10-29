import nodePath from 'node:path';
import type { LocalRequest, ProjectInspection, WorkerStatus } from '@aios/contracts';
import type { GatewayLink } from '../gateway/link.js';
import type { AllowList } from '../paths/allowlist.js';
import type { ProcessManager } from '../process/manager.js';
import type { ProjectBindings } from '../projects/bindings.js';
import { detectStack } from '../projects/detect.js';
import { detectGit } from '../projects/git.js';
import type { PreviewService } from '../preview/service.js';
import { resolveWorkDir } from '../preview/target.js';
import type { FilesService } from '../files/service.js';
import type { GitService } from '../git/service.js';
import type { TerminalService } from '../terminal/service.js';
import type { ReviewService } from '../runs/review.js';
import type { ProjectSetupStore } from '../runs/setup.js';
import type { WorktreeManager } from '../runs/worktree.js';

export interface HandlerDeps {
  allowed: AllowList;
  setup: ProjectSetupStore;
  bindings: ProjectBindings;
  processes: ProcessManager;
  link: GatewayLink;
  review: ReviewService;
  preview: PreviewService;
  terminal: TerminalService;
  files: FilesService;
  git: GitService;
  worktrees: WorktreeManager;
  version: string;
  /** Info alat di PC; diisi tak-sinkron setelah worker berjalan. */
  tools: { ompVersion: string | null; browserAvailable: boolean };
}

export function workerStatus({ link, processes, version, tools }: HandlerDeps): WorkerStatus {
  return {
    gateway: link.state,
    deviceId: link.deviceId,
    activeRuns: processes.activeRunIds().length,
    version,
    ompVersion: tools.ompVersion,
    browserAvailable: tools.browserAvailable,
  };
}

/** Menjalankan satu permintaan dari desktop. Galat path dilempar sebagai PathError (dipetakan oleh server). */
export function createHandler(deps: HandlerDeps): (request: LocalRequest) => Promise<unknown> {
  const { allowed, bindings, processes, link, review, preview, terminal, files, git, worktrees } =
    deps;

  const resolvePreview = (target: { projectId: string; runId?: string | undefined }) =>
    resolveWorkDir({ bindings, worktrees }, target);

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

      case 'setup.get':
        return deps.setup.get(request.params.projectId);

      case 'setup.set': {
        const { projectId, ...setup } = request.params;
        return deps.setup.set(projectId, setup);
      }

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

      case 'files.list': {
        const { path, ...target } = request.params;
        return files.list(target, path);
      }

      case 'files.read': {
        const { path, ...target } = request.params;
        return files.read(target, path);
      }

      case 'files.find': {
        const { query, ...target } = request.params;
        return files.find(target, query);
      }

      case 'git.status':
        return git.status(request.params);

      case 'git.diff': {
        const { path, ...target } = request.params;
        return git.diff(target, path);
      }

      case 'git.log': {
        const { limit, ...target } = request.params;
        return git.log(target, limit);
      }

      case 'git.stage':
        return git.stage(request.params.projectId, request.params.paths, request.params.all);

      case 'git.unstage':
        return git.unstage(request.params.projectId, request.params.paths, request.params.all);

      case 'git.discard':
        return git.discard(request.params.projectId, request.params.path);

      case 'git.commit':
        return git.commit(request.params.projectId, request.params.message);

      case 'git.branches':
        return git.branches(request.params.projectId);

      case 'git.checkout':
        return git.checkout(request.params.projectId, request.params.branch);

      case 'git.pull':
        return git.pull(request.params.projectId);

      case 'git.push':
        return git.push(request.params.projectId);

      case 'terminal.open': {
        const { cols, rows, ...target } = request.params;
        return terminal.open(target, { cols, rows });
      }

      case 'terminal.write':
        terminal.write(request.params.terminalId, request.params.data);
        return {};

      case 'terminal.resize':
        terminal.resize(request.params.terminalId, request.params.cols, request.params.rows);
        return {};

      case 'terminal.close':
        terminal.close(request.params.terminalId);
        return {};

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
