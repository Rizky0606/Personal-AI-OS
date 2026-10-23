import type { ReviewComment, ReviewState } from '@aios/contracts';
import * as Tabs from '@radix-ui/react-tabs';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useOnline } from '../app/hooks';
import { copy } from '../copy';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { StateView, type ViewState } from '../ui/StateView';
import { workerErrorMessage } from '../worker/errors';
import { useWorker } from '../worker/hooks';
import { AcceptDialog } from './AcceptDialog';
import { CheckpointList } from './CheckpointList';
import type { DiffView } from './DiffTable';
import { FileDiff } from './FileDiff';
import { FileList } from './FileList';
import { reviewKey, useReviewState } from './useReview';
import { useReviewActions } from './useReviewActions';

type Dialogs = { kind: 'accept' } | { kind: 'reject' } | { kind: 'revert'; path: string } | null;
interface Editing {
  path: string;
  line: number;
}

const commentKey = (c: { path: string; line: number }) => `${c.path}:${c.line}`;

/** Tinjauan satu run: daftar file, diff unified/split dengan komentar per baris, checkpoint, terima/tolak. */
export function ReviewView({ runId }: { runId: string }) {
  const online = useOnline();
  const worker = useWorker();
  const queryClient = useQueryClient();
  const query = useReviewState(runId);
  const [view, setView] = useState<DiffView>('unified');
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialogs>(null);

  const state: ReviewState | undefined = query.data;
  const actions = useReviewActions(runId, () => {
    // Komentar menunjuk nomor baris pada versi sebelumnya; setelah isi berubah tidak lagi berlaku.
    setComments([]);
    setEditing(null);
  });

  const byFile = useMemo(() => {
    const map = new Map<string, Map<number, string>>();
    for (const c of comments) {
      const lines = map.get(c.path) ?? new Map<number, string>();
      lines.set(c.line, c.body);
      map.set(c.path, lines);
    }
    return map;
  }, [comments]);
  const counts = useMemo(
    () => new Map([...byFile].map(([path, lines]) => [path, lines.size])),
    [byFile],
  );

  const viewState: ViewState =
    worker.local !== 'connected'
      ? 'offline'
      : query.isPending
        ? 'loading'
        : query.isError
          ? 'error'
          : state?.files.length === 0
            ? 'empty'
            : 'content';

  const saveComment = (path: string, line: number, body: string) => {
    setComments((current) => [
      ...current.filter((c) => commentKey(c) !== commentKey({ path, line })),
      { path, line, body },
    ]);
    setEditing(null);
  };

  function select(path: string) {
    setSelected(path);
    document.getElementById(`file-${path}`)?.scrollIntoView?.({ block: 'start' });
  }

  const tab = copy.review.tabs;
  const additions = state?.files.reduce((n, f) => n + f.additions, 0) ?? 0;
  const deletions = state?.files.reduce((n, f) => n + f.deletions, 0) ?? 0;
  const busy = actions.busy || !online;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-col gap-2 border-b border-border p-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-section font-semibold text-text">{copy.review.title}</h2>
          {state ? (
            <span className="font-mono text-meta text-text-2">
              {copy.review.files(state.files.length)}{' '}
              <span className="tabular-nums text-success">+{additions}</span>{' '}
              <span className="tabular-nums text-danger">−{deletions}</span>
            </span>
          ) : null}
        </div>
        {state ? (
          <p className="truncate font-mono text-meta text-text-3">
            {state.branch}
            {state.targetBranch ? ` → ${state.targetBranch}` : ''}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            disabled={!state || busy || state.files.length === 0}
            onClick={() => setDialog({ kind: 'accept' })}
          >
            {copy.review.accept}
          </Button>
          <Button
            variant="secondary"
            disabled={comments.length === 0 || busy}
            onClick={() => void actions.sendComments(comments)}
          >
            {copy.review.sendComments(comments.length)}
          </Button>
          <Button
            variant="danger"
            disabled={!state || busy}
            onClick={() => setDialog({ kind: 'reject' })}
          >
            {copy.review.reject}
          </Button>
          <div role="group" aria-label={copy.review.view.label} className="ml-auto flex gap-1">
            <Chip selected={view === 'unified'} onClick={() => setView('unified')}>
              {copy.review.view.unified}
            </Chip>
            <Chip selected={view === 'split'} onClick={() => setView('split')}>
              {copy.review.view.split}
            </Chip>
          </div>
        </div>
      </header>

      <Tabs.Root defaultValue="changes" className="flex min-h-0 flex-1 flex-col">
        <Tabs.List className="flex h-9 shrink-0 gap-1 border-b border-border px-2">
          {(['changes', 'checkpoints'] as const).map((id) => (
            <Tabs.Trigger
              key={id}
              value={id}
              className="h-8 border-b-2 border-transparent px-3 text-ui text-text-2 hover:text-text data-[state=active]:border-accent data-[state=active]:text-text"
            >
              {tab[id]}
              {id === 'checkpoints' && state ? ` (${state.checkpoints.length})` : ''}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value="changes" className="min-h-0 flex-1 overflow-auto">
          <StateView
            state={viewState}
            loadingLabel={copy.review.loading}
            emptyMessage={copy.review.noChanges}
            errorMessage={query.isError ? workerErrorMessage(query.error) : ''}
            offlineMessage={copy.review.workerOffline}
            retryLabel={copy.review.retry}
            onRetry={() => void queryClient.invalidateQueries({ queryKey: reviewKey(runId) })}
          >
            {state ? (
              <div className="flex flex-col gap-3 p-3">
                <FileList
                  files={state.files}
                  commentCounts={counts}
                  selected={selected}
                  onSelect={select}
                />
                {state.files.map((file) => (
                  <FileDiff
                    key={file.path}
                    file={file}
                    view={view}
                    busy={busy}
                    comments={byFile.get(file.path) ?? new Map<number, string>()}
                    editing={editing?.path === file.path ? editing.line : null}
                    onStartComment={(line) => setEditing({ path: file.path, line })}
                    onSaveComment={(line, body) => saveComment(file.path, line, body)}
                    onCancelComment={() => setEditing(null)}
                    onRemoveComment={(line) =>
                      setComments((current) =>
                        current.filter(
                          (c) => commentKey(c) !== commentKey({ path: file.path, line }),
                        ),
                      )
                    }
                    onRevert={() => setDialog({ kind: 'revert', path: file.path })}
                  />
                ))}
              </div>
            ) : null}
          </StateView>
        </Tabs.Content>
        <Tabs.Content value="checkpoints" className="min-h-0 flex-1 overflow-auto">
          {state ? (
            <CheckpointList
              checkpoints={state.checkpoints}
              busy={busy}
              onRestore={(id) => void actions.restore(id)}
            />
          ) : null}
        </Tabs.Content>
      </Tabs.Root>

      {state && dialog?.kind === 'accept' ? (
        <AcceptDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          state={state}
          busy={actions.busy}
          onAccept={(options) =>
            void actions.accept(options, state.targetBranch).then((ok) => ok && setDialog(null))
          }
        />
      ) : null}
      <ConfirmDialog
        open={dialog?.kind === 'reject'}
        onOpenChange={(open) => !open && setDialog(null)}
        title={copy.review.rejectTitle}
        body={copy.review.rejectBody}
        confirmLabel={copy.review.rejectConfirm}
        cancelLabel={copy.review.cancel}
        destructive
        busy={actions.busy}
        onConfirm={() => void actions.reject().then((ok) => ok && setDialog(null))}
      />
      <ConfirmDialog
        open={dialog?.kind === 'revert'}
        onOpenChange={(open) => !open && setDialog(null)}
        title={copy.review.revertConfirmTitle}
        body={dialog?.kind === 'revert' ? copy.review.revertConfirmBody(dialog.path) : ''}
        confirmLabel={copy.review.revertConfirm}
        cancelLabel={copy.review.cancel}
        destructive
        busy={actions.busy}
        onConfirm={() => {
          if (dialog?.kind !== 'revert') return;
          void actions.revertFile(dialog.path).then(() => setDialog(null));
        }}
      />
    </div>
  );
}
