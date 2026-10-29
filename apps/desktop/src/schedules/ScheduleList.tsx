import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { apiErrorMessage } from '../api/errors';
import { useSchedules } from '../api/queries';
import { useOnline } from '../app/hooks';
import { copy } from '../copy';
import { cn } from '../lib/cn';
import { Button } from '../ui/Button';
import { StateView, type ViewState } from '../ui/StateView';
import { NewScheduleDialog } from './NewScheduleDialog';

/** Daftar ringkas jadwal di sidebar; titik aksen = aktif. Tabel lengkap ada di area utama. */
export function ScheduleList() {
  const query = useSchedules();
  const online = useOnline();
  const params = useParams({ strict: false });
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);
  const items = query.data ?? [];

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
    <>
      <StateView
        state={view}
        loadingLabel={copy.schedules.loading}
        emptyMessage={copy.schedules.empty}
        emptyAction={
          <Button variant="secondary" onClick={() => setDialogOpen(true)}>
            <Plus size={14} strokeWidth={1.5} aria-hidden="true" />
            {copy.schedules.create}
          </Button>
        }
        errorMessage={query.isError ? apiErrorMessage(query.error, online) : ''}
        offlineMessage={copy.states.offline}
        retryLabel={copy.states.retry}
        onRetry={() => void query.refetch()}
      >
        <nav aria-label={copy.schedules.title}>
          {items.map((s) => (
            <Link
              key={s.id}
              to="/schedules/$scheduleId"
              params={{ scheduleId: s.id }}
              aria-current={s.id === params.scheduleId ? 'page' : undefined}
              className={cn(
                'flex min-h-8 items-center gap-2 border-b border-border px-3 py-1 text-ui transition-colors duration-[120ms] ease-aios',
                s.id === params.scheduleId ? 'bg-accent-soft' : 'hover:bg-surface-2',
              )}
            >
              <span
                role="img"
                aria-label={s.enabled ? copy.schedules.enabled : copy.schedules.disabled}
                className={cn(
                  'size-1.5 shrink-0 rounded-full',
                  s.enabled ? 'bg-accent' : 'bg-border-strong',
                )}
              />
              <span className="truncate text-text">{s.name}</span>
            </Link>
          ))}
        </nav>
      </StateView>
      <NewScheduleDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={(id) =>
          void navigate({ to: '/schedules/$scheduleId', params: { scheduleId: id } })
        }
      />
    </>
  );
}
