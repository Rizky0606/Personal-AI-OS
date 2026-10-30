import { useQueryClient } from '@tanstack/react-query';
import { FolderPlus } from 'lucide-react';
import { useState } from 'react';
import { workerApi } from '../app/services';
import { copy } from '../copy';
import { pickFolder } from '../lib/pickFolder';
import { Button } from '../ui/Button';
import { StateView, type ViewState } from '../ui/StateView';
import { useToastStore } from '../ui/Toaster';
import { workerErrorMessage } from './errors';
import { useAllowedFolders, useWorker } from './hooks';

/**
 * Daftar folder yang boleh disentuh worker (SECURITY_OPS.md). Penambahan lewat dialog folder sistem; setiap
 * perubahan diperiksa ulang oleh worker (path dinormalisasi, symlink diselesaikan), bukan dipercaya dari sini.
 */
export function AllowedFolders() {
  const worker = useWorker();
  const query = useAllowedFolders();
  const queryClient = useQueryClient();
  const push = useToastStore((s) => s.push);
  const [busy, setBusy] = useState(false);
  const folders = query.data ?? [];

  async function change(work: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await work();
      await queryClient.invalidateQueries({ queryKey: ['worker'] });
      push(done);
    } catch (error) {
      push(workerErrorMessage(error), 'danger');
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    const picked = await pickFolder(copy.settings.folders.pick);
    if (picked) await change(() => workerApi.addFolder(picked), copy.settings.folders.added);
  }

  const view: ViewState =
    worker.local !== 'connected'
      ? 'offline'
      : query.isPending
        ? 'loading'
        : query.isError
          ? 'error'
          : folders.length === 0
            ? 'empty'
            : 'content';

  const addButton = (
    <Button
      variant="secondary"
      disabled={busy || worker.local !== 'connected'}
      onClick={() => void add()}
    >
      <FolderPlus size={14} strokeWidth={1.5} aria-hidden="true" />
      {copy.settings.folders.add}
    </Button>
  );

  return (
    <section aria-labelledby="settings-folders" className="flex flex-col gap-3">
      <h3 id="settings-folders" className="text-section font-semibold text-text">
        {copy.settings.folders.title}
      </h3>
      <p className="max-w-[72ch] text-ui text-text-2">{copy.settings.folders.hint}</p>
      <StateView
        state={view}
        loadingLabel={copy.settings.folders.loading}
        emptyMessage={copy.settings.folders.empty}
        emptyAction={addButton}
        errorMessage={copy.states.error}
        offlineMessage={copy.settings.folders.workerOff}
        retryLabel={copy.states.retry}
        onRetry={() => void query.refetch()}
      >
        <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-panel border border-border bg-surface">
          {folders.map((folder, index) => (
            <li
              key={folder}
              style={{ animationDelay: `${Math.min(index, 3) * 40}ms` }}
              className="flex min-h-10 animate-aios-enter items-center justify-between gap-3 px-4 py-2 transition-colors duration-[120ms] ease-aios hover:bg-surface-2"
            >
              <span className="min-w-0 truncate font-mono text-ui text-text" title={folder}>
                {folder}
              </span>
              <Button
                variant="ghost"
                disabled={busy}
                aria-label={`${copy.settings.folders.remove}: ${folder}`}
                onClick={() =>
                  void change(() => workerApi.removeFolder(folder), copy.settings.folders.removed)
                }
              >
                {copy.settings.folders.remove}
              </Button>
            </li>
          ))}
        </ul>
        <div className="pt-2">{addButton}</div>
      </StateView>
    </section>
  );
}
