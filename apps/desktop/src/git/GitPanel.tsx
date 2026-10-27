import type { GitFile } from '@aios/contracts';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, GitBranch, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { apiErrorMessage } from '../api/errors';
import { useOnline } from '../app/hooks';
import { workerApi } from '../app/services';
import { copy } from '../copy';
import { cn } from '../lib/cn';
import { relativeTime } from '../lib/time';
import { DiffTable } from '../review/DiffTable';
import { useUiStore } from '../state/uiStore';
import { EmptyState } from '../ui/EmptyState';
import { IconButton } from '../ui/IconButton';
import { StateView, type ViewState } from '../ui/StateView';
import { useWorker } from '../worker/hooks';

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

/**
 * Tab Git: branch dan posisinya terhadap upstream, berkas yang berubah di folder project (klik untuk melihat
 * perubahannya baris demi baris), dan commit terbaru. Hanya baca; disegarkan otomatis tiap beberapa detik
 * selama tab terbuka, jadi perubahan dari agent maupun editor langsung terlihat.
 */
export function GitPanel() {
  const projectId = useUiStore((s) => s.activeProjectId);
  const connected = useWorker().local === 'connected';
  const online = useOnline();
  const [selected, setSelected] = useState<string | null>(null);
  // Project berganti: berkas yang terbuka bukan milik project baru.
  useEffect(() => setSelected(null), [projectId]);

  const enabled = projectId !== null && connected;
  const status = useQuery({
    queryKey: ['worker', 'git', 'status', projectId],
    queryFn: () => workerApi.gitStatus({ projectId: projectId! }),
    enabled,
    refetchInterval: REFRESH_MS,
  });
  const log = useQuery({
    queryKey: ['worker', 'git', 'log', projectId],
    queryFn: () => workerApi.gitLog({ projectId: projectId! }, 15),
    enabled: enabled && status.data?.isRepo === true,
    refetchInterval: REFRESH_MS * 3,
  });
  const files = useMemo(() => status.data?.files ?? [], [status.data]);
  const current = files.find((f) => f.path === selected);

  if (!projectId) return <EmptyState message={copy.git.noProject} />;
  if (!connected) return <EmptyState message={copy.git.workerOffline} />;
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <GitBranch
          size={14}
          strokeWidth={1.5}
          aria-hidden="true"
          className="shrink-0 text-text-3"
        />
        <span className="min-w-0 truncate font-mono text-ui text-text">
          {data ? (data.branch ?? copy.git.detached) : ''}
        </span>
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
        <span className="ml-auto">
          <IconButton label={copy.git.refresh} onClick={() => void status.refetch()}>
            <RefreshCw
              size={14}
              strokeWidth={1.5}
              aria-hidden="true"
              className={cn(status.isFetching && 'animate-aios-breathe')}
            />
          </IconButton>
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
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
            <h3 className="px-3 pt-3 pb-1 text-meta font-medium text-text-2">
              {copy.git.changes(files.length)}
            </h3>
            <ul>
              {files.map((file) => (
                <li key={file.path} className="border-b border-border">
                  <button
                    type="button"
                    aria-label={`${copy.git.openDiff}: ${file.path}`}
                    onClick={() => setSelected(file.path)}
                    className="flex min-h-8 w-full items-center gap-2 px-3 py-1 text-left transition-colors duration-[120ms] ease-aios hover:bg-surface-2"
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
    </div>
  );
}
