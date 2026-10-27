import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { workerApi } from '../app/services';
import { copy } from '../copy';
import { useToastStore } from '../ui/Toaster';
import { workerErrorMessage } from '../worker/errors';
import { WorkerCallError } from '../worker/localClient';

/** Galat git membawa pesan git yang sudah dibersihkan; galat lain memakai pesan umum worker. */
export function gitErrorMessage(error: unknown): string {
  if (error instanceof WorkerCallError && error.code === 'git_failed') {
    return error.message || copy.git.failed;
  }
  return workerErrorMessage(error);
}

/**
 * Aksi git untuk satu project: stage, commit, ganti branch, pull, push. Satu aksi berjalan pada satu waktu
 * (`busy`); setelah selesai, status, riwayat, dan perubahan dibaca ulang. Galat tampil sebagai toast.
 */
export function useGitActions(projectId: string) {
  const queryClient = useQueryClient();
  const push = useToastStore((s) => s.push);
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async <T>(
      action: () => Promise<T>,
      success?: (result: T) => string,
    ): Promise<T | undefined> => {
      setBusy(true);
      try {
        const result = await action();
        if (success) push(success(result));
        return result;
      } catch (error) {
        push(gitErrorMessage(error), 'danger');
        return undefined;
      } finally {
        await queryClient.invalidateQueries({ queryKey: ['worker', 'git'] });
        setBusy(false);
      }
    },
    [queryClient, push],
  );

  return {
    busy,
    stage: (paths: string[], all = false) => run(() => workerApi.gitStage(projectId, paths, all)),
    unstage: (paths: string[], all = false) =>
      run(() => workerApi.gitUnstage(projectId, paths, all)),
    discard: (path: string) =>
      run(
        () => workerApi.gitDiscard(projectId, path),
        (r) => r.message,
      ),
    commit: (message: string) =>
      run(
        () => workerApi.gitCommit(projectId, message),
        (c) => copy.git.committed(c.shortHash, c.subject),
      ),
    checkout: (branch: string) =>
      run(
        () => workerApi.gitCheckout(projectId, branch),
        () => copy.git.switched(branch),
      ),
    pull: () =>
      run(
        () => workerApi.gitPull(projectId),
        () => copy.git.pulled,
      ),
    push: () =>
      run(
        () => workerApi.gitPush(projectId),
        () => copy.git.pushed,
      ),
  };
}
