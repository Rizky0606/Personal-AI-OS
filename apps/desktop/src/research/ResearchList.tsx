import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { apiErrorMessage } from '../api/errors';
import { useResearchList } from '../api/queries';
import { useOnline } from '../app/hooks';
import { copy } from '../copy';
import { cn } from '../lib/cn';
import { relativeTime } from '../lib/time';
import { Button } from '../ui/Button';
import { StateView, type ViewState } from '../ui/StateView';

/** Daftar riset di sidebar, terbaru dulu. */
export function ResearchList() {
  const query = useResearchList();
  const online = useOnline();
  const params = useParams({ strict: false });
  const navigate = useNavigate();
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];

  const view: ViewState = query.isPending
    ? 'loading'
    : query.isError && items.length === 0
      ? online
        ? 'error'
        : 'offline'
      : items.length === 0
        ? 'empty'
        : 'content';

  return (
    <StateView
      state={view}
      loadingLabel={copy.research.listLoading}
      emptyMessage={copy.research.listEmpty}
      errorMessage={query.isError ? apiErrorMessage(query.error, online) : ''}
      offlineMessage={copy.states.offline}
      retryLabel={copy.states.retry}
      onRetry={() => void query.refetch()}
      emptyAction={
        <Button variant="secondary" onClick={() => void navigate({ to: '/research' })}>
          {copy.research.startResearch}
        </Button>
      }
    >
      <nav aria-label={copy.research.listLabel}>
        {items.map((job) => {
          const active = job.id === params.researchId;
          return (
            <Link
              key={job.id}
              to="/research/$researchId"
              params={{ researchId: job.id }}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex min-h-8 flex-col border-b border-border px-3 py-1 transition-colors duration-[120ms] ease-aios',
                active ? 'bg-accent-soft' : 'hover:bg-surface-2',
              )}
            >
              <span className="truncate text-ui text-text">{job.question}</span>
              <span className="truncate text-meta text-text-2">
                {copy.research.status[job.status]} · {relativeTime(job.createdAt)}
              </span>
            </Link>
          );
        })}
        {query.hasNextPage ? (
          <div className="p-2">
            <Button
              variant="ghost"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {copy.research.loadMore}
            </Button>
          </div>
        ) : null}
      </nav>
    </StateView>
  );
}
