import { Link, useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { apiErrorMessage } from '../api/errors';
import { useSchedules } from '../api/queries';
import { useOnline } from '../app/hooks';
import { copy } from '../copy';
import { formatDateTime } from '../lib/time';
import { Button } from '../ui/Button';
import { PageHeader } from '../ui/PageHeader';
import { StateView, type ViewState } from '../ui/StateView';
import { Switch } from '../ui/Switch';
import { NewScheduleDialog } from './NewScheduleDialog';
import { useScheduleActions } from './useScheduleActions';

const headerClass =
  'border-b border-border-strong px-3 py-2 text-left text-meta font-medium text-text-2';
const cellClass = 'border-b border-border px-3 py-1 align-middle text-ui';

/** Tabel jadwal. Jadwal baru dibuat lewat dialog bahasa alami dengan konfirmasi hasil parse. */
export function SchedulesScreen() {
  const query = useSchedules();
  const online = useOnline();
  const navigate = useNavigate();
  const { busy, setEnabled } = useScheduleActions();
  const [dialogOpen, setDialogOpen] = useState(false);
  const schedules = query.data ?? [];

  const view: ViewState = query.isPending
    ? 'loading'
    : query.isError && !query.data
      ? online
        ? 'error'
        : 'offline'
      : schedules.length === 0
        ? 'empty'
        : 'content';

  const newButton = (
    <Button variant="primary" onClick={() => setDialogOpen(true)}>
      <Plus size={14} strokeWidth={1.5} aria-hidden="true" />
      {copy.schedules.newSchedule}
    </Button>
  );

  return (
    <div className="flex flex-col">
      <PageHeader title={copy.schedules.title} primary={view === 'content' ? newButton : null} />
      <StateView
        state={view}
        loadingLabel={copy.schedules.loading}
        emptyMessage={copy.schedules.empty}
        emptyAction={newButton}
        errorMessage={query.isError ? apiErrorMessage(query.error, online) : ''}
        offlineMessage={copy.states.offline}
        retryLabel={copy.states.retry}
        onRetry={() => void query.refetch()}
      >
        <table aria-label={copy.schedules.table} className="w-full border-collapse">
          <thead>
            <tr>
              <th scope="col" className={headerClass}>
                {copy.schedules.columns.name}
              </th>
              <th scope="col" className={headerClass}>
                {copy.schedules.columns.when}
              </th>
              <th scope="col" className={headerClass}>
                {copy.schedules.columns.next}
              </th>
              <th scope="col" className={headerClass}>
                {copy.schedules.columns.target}
              </th>
              <th scope="col" className={headerClass}>
                {copy.schedules.columns.status}
              </th>
            </tr>
          </thead>
          <tbody>
            {schedules.map((s) => (
              <tr
                key={s.id}
                onClick={() =>
                  void navigate({ to: '/schedules/$scheduleId', params: { scheduleId: s.id } })
                }
                className="cursor-pointer transition-colors duration-[120ms] ease-aios hover:bg-surface-2"
              >
                <td className={cellClass}>
                  <Link
                    to="/schedules/$scheduleId"
                    params={{ scheduleId: s.id }}
                    onClick={(event) => event.stopPropagation()}
                    className="font-medium text-text underline-offset-2 hover:underline"
                  >
                    {s.name}
                  </Link>
                </td>
                <td className={`${cellClass} font-mono text-meta text-text-2`}>
                  {s.cron}
                  <span className="block text-caption text-text-3">{s.timezone}</span>
                </td>
                <td className={`${cellClass} text-text-2`}>
                  {s.enabled && s.nextRunAt
                    ? formatDateTime(s.nextRunAt, s.timezone)
                    : copy.schedules.never}
                </td>
                <td className={`${cellClass} text-text-2`}>
                  {copy.schedules.targets[s.target]}
                  {s.agentRole ? ` · ${s.agentRole}` : ''}
                </td>
                <td className={cellClass} onClick={(event) => event.stopPropagation()}>
                  <span className="flex items-center gap-2">
                    <Switch
                      checked={s.enabled}
                      disabled={busy === `toggle:${s.id}`}
                      label={`${s.enabled ? copy.schedules.detail.disable : copy.schedules.detail.enable}: ${s.name}`}
                      onChange={(enabled) => void setEnabled(s.id, enabled)}
                    />
                    <span className="text-meta text-text-2">
                      {s.enabled ? copy.schedules.enabled : copy.schedules.disabled}
                    </span>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </StateView>
      <NewScheduleDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={(id) =>
          void navigate({ to: '/schedules/$scheduleId', params: { scheduleId: id } })
        }
      />
    </div>
  );
}
