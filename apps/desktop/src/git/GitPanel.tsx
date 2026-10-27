import type { GitFile } from '@aios/contracts';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpFromLine,
  ChevronDown,
  GitBranch,
  Minus,
  Plus,
  RefreshCw,
  Undo2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { apiErrorMessage } from '../api/errors';
import { useOnline } from '../app/hooks';
import { workerApi } from '../app/services';
import { copy } from '../copy';
import { cn } from '../lib/cn';
import { relativeTime } from '../lib/time';
import { DiffTable } from '../review/DiffTable';
import { useUiStore } from '../state/uiStore';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { EmptyState } from '../ui/EmptyState';
import { IconButton } from '../ui/IconButton';
import { RadioMenu } from '../ui/RadioMenu';
import { StateView, type ViewState } from '../ui/StateView';
import { TextArea } from '../ui/TextArea';
import { useWorker } from '../worker/hooks';
import { useGitActions } from './useGitActions';

const REFRESH_MS = 5_000;
const noop = () => undefined;
const NO_COMMENTS: ReadonlyMap<number, string> = new Map();

const badgeTone: Record<GitFile['status'], string> = {
  modified: 'bg-accent-soft text-text',
  added: 'bg-success/15 text-text',
  deleted: 'bg-danger/15 text-text',
  renamed: 'bg-surface-2 text-text-2',
  untracked: 'bg-surface-2 text-text-2',
  conflicted: 'bg-warning/20 text-text',
};

/** Perubahan satu berkas terhadap HEAD, dalam diff berwarna (hanya lihat). */
function FileChange({
  projectId,
  file,
  onBack,
}: {
  projectId: string;
  file: GitFile;
  onBack: () => void;
}) {
  const online = useOnline();
  const query = useQuery({
    queryKey: ['worker', 'git', 'diff', projectId, file.path],
    queryFn: () => workerApi.gitDiff({ projectId }, file.path),
  });
  const view: ViewState = query.isPending
    ? 'loading'
    : query.isError
      ? online
        ? 'error'
        : 'offline'
      : 'content';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-2">
        <IconButton label={copy.git.back} onClick={onBack}>
          <ArrowLeft size={16} strokeWidth={1.5} aria-hidden="true" />
        </IconButton>
        <span className="min-w-0 flex-1 truncate font-mono text-ui text-text">{file.path}</span>
        <span className={cn('shrink-0 rounded-badge px-1.5 text-caption', badgeTone[file.status])}>
          {copy.git.status[file.status]}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <StateView
          state={view}
          loadingLabel={copy.git.diffLoading}
          emptyMessage={copy.git.noDiff}
          errorMessage={query.isError ? apiErrorMessage(query.error, online) : copy.git.diffFailed}
          offlineMessage={copy.states.offline}
          retryLabel={copy.states.retry}
          onRetry={() => void query.refetch()}
        >
          {query.data?.binary ? (
            <p className="p-3 text-ui text-text-2">{copy.git.binary}</p>
          ) : query.data?.patch ? (
            <>
              <DiffTable
                path={file.path}
                patch={query.data.patch}
                view="unified"
                comments={NO_COMMENTS}
                editing={null}
                onStartComment={noop}
                onSaveComment={noop}
                onCancelComment={noop}
                onRemoveComment={noop}
                readOnly
              />
              {query.data.truncated ? (
                <p className="p-2 text-meta text-text-3">{copy.git.diffTruncated}</p>
              ) : null}
            </>
          ) : (
            <p className="p-3 text-ui text-text-2">{copy.git.noDiff}</p>
          )}
        </StateView>
      </div>
    </div>
  );
}

/** Tab Git untuk satu project yang terikat dan worker yang tersambung. */
function GitProject({ projectId }: { projectId: string }) {
  const online = useOnline();
  const actions = useGitActions(projectId);
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [discardOf, setDiscardOf] = useState<GitFile | null>(null);
  const [pushOpen, setPushOpen] = useState(false);
  // Project berganti: berkas yang terbuka bukan milik project baru.
  useEffect(() => setSelected(null), [projectId]);

  const status = useQuery({
    queryKey: ['worker', 'git', 'status', projectId],
    queryFn: () => workerApi.gitStatus({ projectId }),
    refetchInterval: REFRESH_MS,
  });
  const isRepo = status.data?.isRepo === true;
  const log = useQuery({
    queryKey: ['worker', 'git', 'log', projectId],
    queryFn: () => workerApi.gitLog({ projectId }, 15),
    enabled: isRepo,
    refetchInterval: REFRESH_MS * 3,
  });
  const branches = useQuery({
    queryKey: ['worker', 'git', 'branches', projectId],
    queryFn: () => workerApi.gitBranches(projectId),
    enabled: isRepo,
    refetchInterval: REFRESH_MS * 3,
  });
  const files = useMemo(() => status.data?.files ?? [], [status.data]);
  const stagedCount = files.filter((f) => f.staged).length;
  const current = files.find((f) => f.path === selected);

  if (status.data && !status.data.isRepo) return <EmptyState message={copy.git.notRepo} />;
  if (current) {
    return <FileChange projectId={projectId} file={current} onBack={() => setSelected(null)} />;
  }

  const view: ViewState = status.isPending
    ? 'loading'
    : status.isError && !status.data
      ? online
        ? 'error'
        : 'offline'
      : files.length === 0
        ? 'empty'
        : 'content';
  const data = status.data;
  const branchName = data ? (data.branch ?? copy.git.detached) : '';
  const canCommit = stagedCount > 0 && message.trim().length > 0 && !actions.busy;

  async function commit() {
    const done = await actions.commit(message.trim());
    if (done) setMessage('');
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <GitBranch
          size={14}
          strokeWidth={1.5}
          aria-hidden="true"
          className="shrink-0 text-text-3"
        />
        {(branches.data?.branches.length ?? 0) > 1 ? (
          <RadioMenu
            label={copy.git.branchPick}
            value={branches.data?.current ?? ''}
            onValueChange={(branch) => void actions.checkout(branch)}
            options={(branches.data?.branches ?? []).map((b) => ({ value: b, label: b }))}
            trigger={
              <button
                type="button"
                aria-label={`${copy.git.branchPick}: ${branchName}`}
                disabled={actions.busy}
                className="flex min-w-0 items-center gap-1 rounded-control px-1 font-mono text-ui text-text transition-colors duration-[120ms] ease-aios hover:bg-surface-2 disabled:opacity-60"
              >
                <span className="truncate">{branchName}</span>
                <ChevronDown size={12} strokeWidth={1.5} aria-hidden="true" className="shrink-0" />
              </button>
            }
          />
        ) : (
          <span className="min-w-0 truncate font-mono text-ui text-text">{branchName}</span>
        )}
        {data?.upstream ? (
          <span className="shrink-0 text-meta text-text-3">
            {[
              data.ahead > 0 ? copy.git.ahead(data.ahead) : null,
              data.behind > 0 ? copy.git.behind(data.behind) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        ) : data?.branch ? (
          <span className="shrink-0 text-meta text-text-3">{copy.git.noUpstream}</span>
        ) : null}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          <IconButton
            label={copy.git.pull}
            title={copy.git.pullHint}
            disabled={actions.busy || !data?.upstream}
            onClick={() => void actions.pull()}
          >
            <ArrowDownToLine size={14} strokeWidth={1.5} aria-hidden="true" />
          </IconButton>
          <IconButton
            label={copy.git.push}
            title={copy.git.pushHint}
            disabled={actions.busy || !data?.branch}
            onClick={() => setPushOpen(true)}
          >
            <ArrowUpFromLine size={14} strokeWidth={1.5} aria-hidden="true" />
          </IconButton>
          <IconButton label={copy.git.refresh} onClick={() => void status.refetch()}>
            <RefreshCw
              size={14}
              strokeWidth={1.5}
              aria-hidden="true"
              className={cn((status.isFetching || actions.busy) && 'animate-aios-breathe')}
            />
          </IconButton>
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <section
          aria-label={copy.git.commitLabel}
          className="flex flex-col gap-2 border-b border-border p-3"
        >
          <TextArea
            label={copy.git.commitLabel}
            rows={2}
            value={message}
            disabled={actions.busy}
            placeholder={copy.git.commitPlaceholder}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && canCommit) {
                event.preventDefault();
                void commit();
              }
            }}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-caption text-text-3">
              {stagedCount === 0 && files.length > 0 ? copy.git.nothingStaged : ''}
            </span>
            <Button variant="primary" disabled={!canCommit} onClick={() => void commit()}>
              {actions.busy ? copy.git.working : copy.git.commit(stagedCount)}
            </Button>
          </div>
        </section>

        <section aria-label={copy.git.changes(files.length)}>
          <StateView
            state={view}
            loadingLabel={copy.git.loading}
            emptyMessage={copy.git.clean}
            errorMessage={status.isError ? apiErrorMessage(status.error, online) : ''}
            offlineMessage={copy.states.offline}
            retryLabel={copy.states.retry}
            onRetry={() => void status.refetch()}
          >
            <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-1">
              <h3 className="text-meta font-medium text-text-2">
                {copy.git.changes(files.length)}
              </h3>
              <span className="flex gap-1">
                <Button
                  variant="ghost"
                  disabled={actions.busy || stagedCount === files.length}
                  onClick={() => void actions.stage([], true)}
                >
                  {copy.git.stageAll}
                </Button>
                {stagedCount > 0 ? (
                  <Button
                    variant="ghost"
                    disabled={actions.busy}
                    onClick={() => void actions.unstage([], true)}
                  >
                    {copy.git.unstageAll}
                  </Button>
                ) : null}
              </span>
            </div>
            <ul>
              {files.map((file) => (
                <li key={file.path} className="group flex items-center border-b border-border">
                  <IconButton
                    label={`${file.staged && !file.unstaged ? copy.git.unstage : copy.git.stage}: ${file.path}`}
                    disabled={actions.busy}
                    onClick={() =>
                      void (file.staged && !file.unstaged
                        ? actions.unstage([file.path])
                        : actions.stage([file.path]))
                    }
                  >
                    {file.staged && !file.unstaged ? (
                      <Minus size={14} strokeWidth={1.5} aria-hidden="true" />
                    ) : (
                      <Plus size={14} strokeWidth={1.5} aria-hidden="true" />
                    )}
                  </IconButton>
                  <button
                    type="button"
                    aria-label={`${copy.git.openDiff}: ${file.path}`}
                    onClick={() => setSelected(file.path)}
                    className="flex min-h-8 min-w-0 flex-1 items-center gap-2 py-1 pr-1 text-left transition-colors duration-[120ms] ease-aios hover:bg-surface-2"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-ui text-text">
                        {file.path}
                      </span>
                      {file.oldPath ? (
                        <span className="block truncate font-mono text-caption text-text-3">
                          {copy.git.renamedFrom(file.oldPath)}
                        </span>
                      ) : null}
                    </span>
                    {file.staged ? (
                      <span className="shrink-0 text-caption text-text-3">{copy.git.staged}</span>
                    ) : null}
                    <span
                      className={cn(
                        'shrink-0 rounded-badge px-1.5 text-caption',
                        badgeTone[file.status],
                      )}
                    >
                      {copy.git.status[file.status]}
                    </span>
                  </button>
                  <span className="opacity-0 transition-opacity duration-[120ms] group-focus-within:opacity-100 group-hover:opacity-100">
                    <IconButton
                      label={`${copy.git.discard}: ${file.path}`}
                      disabled={actions.busy}
                      onClick={() => setDiscardOf(file)}
                    >
                      <Undo2 size={14} strokeWidth={1.5} aria-hidden="true" />
                    </IconButton>
                  </span>
                </li>
              ))}
            </ul>
            {data?.truncated ? (
              <p className="px-3 py-1 text-meta text-text-3">{copy.git.truncated}</p>
            ) : null}
          </StateView>
        </section>

        <section aria-label={copy.git.history} className="pb-3">
          <h3 className="px-3 pt-4 pb-1 text-meta font-medium text-text-2">{copy.git.history}</h3>
          {log.data?.commits.length === 0 ? (
            <p className="px-3 py-1 text-ui text-text-3">{copy.git.historyEmpty}</p>
          ) : (
            <ul aria-label={copy.git.historyLabel}>
              {log.data?.commits.map((commit) => (
                <li
                  key={commit.hash}
                  className="flex items-baseline gap-2 border-b border-border px-3 py-1"
                >
                  <span className="shrink-0 font-mono text-caption text-text-3">
                    {commit.shortHash}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-ui text-text">
                    {commit.subject}
                  </span>
                  <span className="shrink-0 text-caption text-text-3">
                    {commit.author} · {relativeTime(commit.date)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={discardOf !== null}
        onOpenChange={(open) => {
          if (!open) setDiscardOf(null);
        }}
        title={copy.git.discardTitle}
        body={discardOf ? copy.git.discardBody(discardOf.path) : ''}
        confirmLabel={copy.git.discardConfirm}
        cancelLabel={copy.git.cancel}
        destructive
        busy={actions.busy}
        onConfirm={() => {
          const target = discardOf;
          setDiscardOf(null);
          if (target) void actions.discard(target.path);
        }}
      />
      <ConfirmDialog
        open={pushOpen}
        onOpenChange={setPushOpen}
        title={copy.git.pushTitle}
        body={copy.git.pushBody(data?.branch ?? '', data?.upstream ?? null)}
        confirmLabel={copy.git.pushConfirm}
        cancelLabel={copy.git.cancel}
        busy={actions.busy}
        onConfirm={() => {
          setPushOpen(false);
          void actions.push();
        }}
      />
    </div>
  );
}

/**
 * Tab Git: branch (bisa ganti), posisi terhadap upstream, pull dan push, berkas yang berubah (stage, lihat
 * perubahan baris demi baris, buang), kotak commit, dan commit terbaru. Disegarkan otomatis tiap beberapa detik
 * selama tab terbuka, jadi perubahan dari agent maupun editor langsung terlihat. Aksi hanya untuk folder
 * project, tidak pernah force, dan yang merusak atau keluar (buang, push) meminta konfirmasi.
 */
export function GitPanel() {
  const projectId = useUiStore((s) => s.activeProjectId);
  const connected = useWorker().local === 'connected';
  if (!projectId) return <EmptyState message={copy.git.noProject} />;
  if (!connected) return <EmptyState message={copy.git.workerOffline} />;
  return <GitProject projectId={projectId} />;
}
