import type { ProjectBindings } from '../projects/bindings.js';
import type { WorktreeManager } from '../runs/worktree.js';
import { PreviewError } from './service.js';

/** Folder kerja untuk project (folder terikat) atau worktree sebuah run; dipakai preview dan terminal. */
export async function resolveWorkDir(
  deps: { bindings: ProjectBindings; worktrees: WorktreeManager },
  target: { projectId: string; runId?: string | undefined },
): Promise<{ cwd: string; projectPath: string }> {
  const projectPath = await deps.bindings.pathFor(target.projectId);
  if (projectPath === undefined) {
    throw new PreviewError('preview_unavailable', 'Project ini belum terikat ke folder di PC ini.');
  }
  if (!target.runId) return { cwd: projectPath, projectPath };
  const worktree = deps.worktrees.get(target.runId);
  if (!worktree) {
    throw new PreviewError(
      'preview_unavailable',
      'Worktree run ini sudah tidak ada. Hanya tersedia sebelum hasil diterima atau ditolak.',
    );
  }
  return { cwd: worktree.cwd, projectPath };
}
