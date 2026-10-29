import { Link, useParams } from '@tanstack/react-router';
import { apiErrorMessage } from '../api/errors';
import { useSpaces } from '../api/queries';
import { useOnline } from '../app/hooks';
import { copy } from '../copy';
import { cn } from '../lib/cn';
import { enterDelay } from '../screens/PageLayout';
import { StateView, type ViewState } from '../ui/StateView';

/** Daftar ruang di sidebar beserta jumlah dokumennya. */
export function SpaceList() {
  const query = useSpaces();
  const online = useOnline();
  const params = useParams({ strict: false });
  const items = query.data ?? [];
  const s = copy.spaces;

  const view: ViewState = query.isPending
    ? 'loading'
    : query.isError && !query.data
      ? online
        ? 'error'
        : 'offline'
      : items.length === 0
        ? 'empty'
        : 'content';

  return (
    <StateView
      state={view}
      loadingLabel={s.loading}
      emptyMessage={s.empty}
      errorMessage={query.isError ? apiErrorMessage(query.error, online) : ''}
      offlineMessage={copy.states.offline}
      retryLabel={copy.states.retry}
      onRetry={() => void query.refetch()}
    >
      <nav aria-label={s.listLabel} className="flex flex-col gap-0.5 p-1">
        {items.map((space, index) => (
          <Link
            key={space.id}
            to="/spaces/$spaceId"
            params={{ spaceId: space.id }}
            aria-current={space.id === params.spaceId ? 'page' : undefined}
            style={enterDelay(index)}
            className={cn(
              'flex min-h-9 animate-aios-enter flex-col justify-center rounded-control border-l-2 px-3 py-1.5 transition-colors duration-[120ms] ease-aios',
              space.id === params.spaceId
                ? 'border-l-accent bg-accent-soft'
                : 'border-l-transparent hover:bg-surface-2',
            )}
          >
            <span className="truncate text-ui text-text">{space.name}</span>
            <span className="text-meta text-text-2">{s.documentCount(space.documentCount)}</span>
          </Link>
        ))}
      </nav>
    </StateView>
  );
}
