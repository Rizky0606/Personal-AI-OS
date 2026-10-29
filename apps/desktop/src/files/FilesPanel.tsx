import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, File as FileIcon, Folder, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { fileActivities } from '../activity/activity';
import { apiErrorMessage } from '../api/errors';
import { useOnline } from '../app/hooks';
import { workerApi } from '../app/services';
import { copy } from '../copy';
import { cn } from '../lib/cn';
import { useUiStore } from '../state/uiStore';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { PickProjectButton, WorkerStatusButton } from '../ui/EmptyActions';
import { StateView, type ViewState } from '../ui/StateView';
import { useWorker } from '../worker/hooks';
import { FileViewer } from './FileViewer';

/** Folder yang sedang dijelajahi: project, atau worktree run yang sedang ditinjau. */
export interface FilesTarget {
  projectId: string;
  runId?: string | undefined;
}

const INDENT = ['pl-2', 'pl-5', 'pl-8', 'pl-11', 'pl-14'] as const;

function Directory({
  target,
  path,
  depth,
  open,
  onOpenFile,
}: {
  target: FilesTarget;
  path: string;
  depth: number;
  open: string | null;
  onOpenFile: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const online = useOnline();
  const steps = useUiStore((s) => s.agentSteps);
  const touched = useMemo(
    () => new Map(fileActivities(steps).map((f) => [f.path, f.action])),
    [steps],
  );
  const query = useQuery({
    queryKey: ['worker', 'files', target.projectId, target.runId ?? null, path],
    queryFn: () => workerApi.filesList(target, path),
  });
  const view: ViewState = query.isPending
    ? 'loading'
    : query.isError
      ? online
        ? 'error'
        : 'offline'
      : (query.data?.entries.length ?? 0) === 0
        ? 'empty'
        : 'content';

  return (
    <StateView
      state={view}
      loadingLabel={copy.files.loading}
      emptyMessage={copy.files.emptyFolder}
      errorMessage={query.isError ? apiErrorMessage(query.error, online) : ''}
      offlineMessage={copy.states.offline}
      retryLabel={copy.states.retry}
      onRetry={() => void query.refetch()}
      emptyAction={
        <Button variant="secondary" onClick={() => void query.refetch()}>
          {copy.files.refresh}
        </Button>
      }
    >
      <ul
        role={depth === 0 ? 'tree' : 'group'}
        aria-label={depth === 0 ? copy.files.tree : undefined}
      >
        {query.data?.entries.map((entry) => {
          const indent = INDENT[Math.min(depth, INDENT.length - 1)];
          if (entry.kind === 'file') {
            return (
              <li key={entry.path} role="treeitem" aria-selected={open === entry.path}>
                <button
                  type="button"
                  onClick={() => onOpenFile(entry.path)}
                  className={cn(
                    'flex min-h-8 w-full items-center gap-2 pr-2 text-left text-ui transition-colors duration-[120ms] ease-aios',
                    indent,
                    open === entry.path ? 'bg-accent-soft' : 'hover:bg-surface-2',
                  )}
                >
                  <FileIcon
                    size={14}
                    strokeWidth={1.5}
                    aria-hidden="true"
                    className="shrink-0 text-text-3"
                  />
                  <span className="truncate text-text">{entry.name}</span>
                  {touched.has(entry.path) ? (
                    <span
                      className={cn(
                        'ml-auto shrink-0 rounded-badge px-1.5 text-caption',
                        touched.get(entry.path) === 'edit'
                          ? 'bg-accent-soft text-text'
                          : 'bg-surface-2 text-text-2',
                      )}
                    >
                      {touched.get(entry.path) === 'edit'
                        ? copy.files.touchedEdit
                        : copy.files.touchedRead}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          }
          const isOpen = expanded.has(entry.path);
          return (
            <li key={entry.path} role="treeitem" aria-expanded={isOpen}>
              <button
                type="button"
                onClick={() =>
                  setExpanded((current) => {
                    const next = new Set(current);
                    if (!next.delete(entry.path)) next.add(entry.path);
                    return next;
                  })
                }
                className={cn(
                  'flex min-h-8 w-full items-center gap-2 pr-2 text-left text-ui transition-colors duration-[120ms] ease-aios hover:bg-surface-2',
                  indent,
                )}
              >
                {isOpen ? (
                  <ChevronDown
                    size={14}
                    strokeWidth={1.5}
                    aria-hidden="true"
                    className="shrink-0 text-text-3"
                  />
                ) : (
                  <ChevronRight
                    size={14}
                    strokeWidth={1.5}
                    aria-hidden="true"
                    className="shrink-0 text-text-3"
                  />
                )}
                <Folder
                  size={14}
                  strokeWidth={1.5}
                  aria-hidden="true"
                  className="shrink-0 text-text-2"
                />
                <span className="truncate text-text">{entry.name}</span>
              </button>
              {isOpen ? (
                <Directory
                  target={target}
                  path={entry.path}
                  depth={depth + 1}
                  open={open}
                  onOpenFile={onOpenFile}
                />
              ) : null}
            </li>
          );
        })}
        {query.data?.truncated ? (
          <li className="px-3 py-1 text-meta text-text-3">{copy.files.truncated}</li>
        ) : null}
      </ul>
    </StateView>
  );
}

/** Quick-open: pencarian nama berkas longgar di seluruh folder; Enter membuka hasil pertama. */
function QuickOpen({
  target,
  inputRef,
  onOpenFile,
}: {
  target: FilesTarget;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onOpenFile: (path: string) => void;
}) {
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(text.trim()), 150);
    return () => clearTimeout(timer);
  }, [text]);
  const results = useQuery({
    queryKey: ['worker', 'find', target.projectId, target.runId ?? null, debounced],
    queryFn: () => workerApi.filesFind(target, debounced),
    enabled: debounced.length > 0,
  });
  const paths = results.data ?? [];

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' && paths[0]) {
      onOpenFile(paths[0]);
      setText('');
    } else if (event.key === 'Escape') {
      setText('');
    }
  }

  return (
    <div className="border-b border-border">
      <label className="flex h-9 items-center gap-2 px-3">
        <Search size={14} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-text-3" />
        <input
          ref={inputRef}
          type="search"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          aria-label={copy.files.quickOpen}
          placeholder={copy.files.quickOpenPlaceholder}
          className="min-w-0 flex-1 bg-transparent text-ui text-text outline-none placeholder:text-text-3"
        />
      </label>
      {debounced.length > 0 ? (
        <ul
          aria-label={copy.files.results}
          className="max-h-48 overflow-auto border-t border-border"
        >
          {paths.length === 0 && !results.isPending ? (
            <li className="px-3 py-2 text-meta text-text-3">{copy.files.noResults}</li>
          ) : (
            paths.map((path) => (
              <li key={path}>
                <button
                  type="button"
                  onClick={() => {
                    onOpenFile(path);
                    setText('');
                  }}
                  className="block w-full truncate px-3 py-1 text-left text-ui text-text transition-colors duration-[120ms] ease-aios hover:bg-surface-2"
                >
                  {path}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Isi tab Berkas: pohon folder project atau worktree run (hanya baca), quick-open (Ctrl+P di panel ini), dan
 * penampil berkas dengan pratinjau Markdown dan gambar. Berkas bisa dikirim ke prompt sebagai konteks.
 */
export function FilesPanel() {
  const projectId = useUiStore((s) => s.activeProjectId);
  const runId = useUiStore((s) => s.reviewRunId);
  const connected = useWorker().local === 'connected';
  const [file, setFile] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Target berganti (project atau run lain): berkas yang terbuka bukan milik target baru.
  useEffect(() => setFile(null), [projectId, runId]);
  // Berkas yang diminta dari tab Aktivitas.
  const request = useUiStore((s) => s.fileRequest);
  useEffect(() => {
    if (!request) return;
    setFile(request.path);
    // Dipakai sekali: membuka tab Berkas nanti tidak membuka ulang berkas lama.
    useUiStore.setState({ fileRequest: null });
  }, [request]);

  if (!projectId) {
    return <EmptyState message={copy.files.noProject} action={<PickProjectButton />} />;
  }
  if (!connected) {
    return <EmptyState message={copy.files.workerOffline} action={<WorkerStatusButton />} />;
  }
  const target: FilesTarget = { projectId, ...(runId ? { runId } : {}) };

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      onKeyDown={(event) => {
        if (event.ctrlKey && event.key.toLowerCase() === 'p') {
          event.preventDefault();
          setFile(null);
          searchRef.current?.focus();
        }
      }}
    >
      {file ? (
        <FileViewer
          key={`${runId ?? ''}:${file}`}
          target={target}
          path={file}
          onBack={() => setFile(null)}
        />
      ) : null}
      <div className={cn('flex min-h-0 flex-1 flex-col', file ? 'hidden' : undefined)}>
        <QuickOpen target={target} inputRef={searchRef} onOpenFile={setFile} />
        <div className="min-h-0 flex-1 overflow-auto">
          <Directory
            key={`${projectId}:${runId ?? ''}`}
            target={target}
            path=""
            depth={0}
            open={file}
            onOpenFile={setFile}
          />
        </div>
      </div>
    </div>
  );
}
