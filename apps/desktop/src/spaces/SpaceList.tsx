import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { apiErrorMessage } from '../api/errors';
import { useSpaces } from '../api/queries';
import { useOnline } from '../app/hooks';
import { copy } from '../copy';
import { cn } from '../lib/cn';
import { Button } from '../ui/Button';
import { enterProps } from '../ui/enter';
import { StateView, type ViewState } from '../ui/StateView';

/** Daftar ruang di sidebar beserta jumlah dokumennya. */
export function SpaceList() {
  const query = useSpaces();
  const online = useOnline();
  const params = useParams({ strict: false });
  const navigate = useNavigate();
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
      emptyAction={
        <Button variant="secondary" onClick={() => void navigate({ to: '/spaces' })}>
          {s.createNew}
        </Button>
      }
      errorMessage={query.isError ? apiErrorMessage(query.error, online) : ''}
      offlineMessage={copy.states.offline}
      retryLabel={copy.states.retry}
      onRetry={() => void query.refetch()}
    >
      <nav aria-label={s.listLabel}>
        {items.map((space, i) => (
          <Link
            key={space.id}
            to="/spaces/$spaceId"
            params={{ spaceId: space.id }}
            aria-current={space.id === params.spaceId ? 'page' : undefined}
            style={enterProps(i).style}
            className={cn(
              'flex min-h-8 flex-col justify-center border-b border-border px-3 py-1 transition-colors duration-[120ms] ease-aios',
              space.id === params.spaceId ? 'bg-accent-soft' : 'hover:bg-surface-2',
              enterProps(i).className,
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
