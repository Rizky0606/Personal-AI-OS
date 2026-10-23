import { Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { apiErrorMessage } from '../api/errors';
import { useScheduleRuns, useSchedules } from '../api/queries';
import { useOnline } from '../app/hooks';
import { copy } from '../copy';
import { cn } from '../lib/cn';
import { formatDateTime } from '../lib/time';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { StateView, type ViewState } from '../ui/StateView';
import { Switch } from '../ui/Switch';
import { useScheduleActions } from './useScheduleActions';

const statusTone = {
  running: 'text-accent',
  succeeded: 'text-success',
  failed: 'text-danger',
  missed: 'text-warning',
} as const;

/** Satu jadwal: pengaturan, jalankan sekarang, hapus, dan riwayat run. */
export function ScheduleDetailScreen({ scheduleId }: { scheduleId: string }) {
  const online = useOnline();
  const schedulesQuery = useSchedules();
  const runsQuery = useScheduleRuns(scheduleId);
  const { busy, setEnabled, runNow, remove } = useScheduleActions();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const schedule = schedulesQuery.data?.find((s) => s.id === scheduleId);
  const runs = runsQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const d = copy.schedules.detail;

  const view: ViewState = schedulesQuery.isPending
    ? 'loading'
    : schedulesQuery.isError && !schedulesQuery.data
      ? online
        ? 'error'
        : 'offline'
      : schedule
        ? 'content'
        : 'empty';

  return (
    <div className="flex flex-col">
      <div className="flex h-12 items-center border-b border-border px-4">
        <Link
          to="/schedules"
          className="flex items-center gap-1 rounded-control text-ui text-text-2 hover:text-text"
        >
          <ArrowLeft size={14} strokeWidth={1.5} aria-hidden="true" />
          {d.back}
        </Link>
      </div>
      <StateView
        state={view}
        loadingLabel={copy.schedules.loading}
        emptyMessage={copy.errors.notFound}
        errorMessage={schedulesQuery.isError ? apiErrorMessage(schedulesQuery.error, online) : ''}
        offlineMessage={copy.states.offline}
        retryLabel={copy.states.retry}
        onRetry={() => void schedulesQuery.refetch()}
      >
        {schedule ? (
          <div className="flex max-w-3xl flex-col gap-6 p-6">
            <header className="flex flex-col gap-2">
              <h2 className="text-section font-semibold text-text">{schedule.name}</h2>
              <p className="font-mono text-meta text-text-2">
                {schedule.cron} · {schedule.timezone}
              </p>
              <p className="text-ui text-text-2">
                {copy.schedules.targets[schedule.target]}
                {schedule.agentRole ? ` · ${schedule.agentRole}` : ''}
              </p>
              <p className="max-w-[72ch] text-chat whitespace-pre-wrap text-text">
                {schedule.prompt}
              </p>
              <p className="text-meta text-text-2">
                {copy.schedules.columns.next}:{' '}
                {schedule.enabled && schedule.nextRunAt
                  ? formatDateTime(schedule.nextRunAt, schedule.timezone)
                  : copy.schedules.never}
              </p>
            </header>

            <div className="flex flex-wrap items-center gap-3">
              <Switch
                checked={schedule.enabled}
                disabled={busy === `toggle:${schedule.id}`}
                label={schedule.enabled ? d.disable : d.enable}
                onChange={(enabled) => void setEnabled(schedule.id, enabled)}
              />
              <span className="text-ui text-text-2">
                {schedule.enabled ? copy.schedules.enabled : copy.schedules.disabled}
              </span>
              <Button
                variant="secondary"
                disabled={busy === `run:${schedule.id}`}
                onClick={() => void runNow(schedule.id)}
              >
                {d.runNow}
              </Button>
              {schedule.conversationId ? (
                <Link
                  to="/chat/$conversationId"
                  params={{ conversationId: schedule.conversationId }}
                  className="text-ui text-info underline underline-offset-2"
                >
                  {d.openResult}
                </Link>
              ) : null}
              <span className="ml-auto">
                {confirmDelete ? (
                  <span role="alert" className="flex items-center gap-2 text-ui text-text">
                    {d.deleteConfirm}
                    <Button
                      variant="danger"
                      disabled={busy === `delete:${schedule.id}`}
                      onClick={() => void remove(schedule.id)}
                    >
                      {d.deleteYes}
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                      {copy.chat.cancel}
                    </Button>
                  </span>
                ) : (
                  <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                    {d.delete}
                  </Button>
                )}
              </span>
            </div>

            <section className="flex flex-col gap-2">
              <h3 className="text-chat font-semibold text-text">{d.history}</h3>
              {runsQuery.isPending ? (
                <p role="status" className="text-ui text-text-2">
                  {copy.states.loading}
                </p>
              ) : runsQuery.isError && runs.length === 0 ? (
                <p role="alert" className="text-ui text-danger">
                  {apiErrorMessage(runsQuery.error, online)}
                </p>
              ) : runs.length === 0 ? (
                <EmptyState message={d.historyEmpty} />
              ) : (
                <table aria-label={d.history} className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th
                        scope="col"
                        className="border-b border-border-strong px-3 py-2 text-left text-meta font-medium text-text-2"
                      >
                        {d.started}
                      </th>
                      <th
                        scope="col"
                        className="border-b border-border-strong px-3 py-2 text-left text-meta font-medium text-text-2"
                      >
                        {d.finished}
                      </th>
                      <th
                        scope="col"
                        className="border-b border-border-strong px-3 py-2 text-left text-meta font-medium text-text-2"
                      >
                        {copy.schedules.columns.status}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((run) => (
                      <tr key={run.id}>
                        <td className="border-b border-border px-3 py-1 text-ui">
                          {formatDateTime(run.startedAt, schedule.timezone)}
                        </td>
                        <td className="border-b border-border px-3 py-1 text-ui text-text-2">
                          {run.finishedAt ? formatDateTime(run.finishedAt, schedule.timezone) : '-'}
                        </td>
                        <td
                          className={cn(
                            'border-b border-border px-3 py-1 text-ui',
                            statusTone[run.status],
                          )}
                        >
                          {copy.schedules.runStatus[run.status]}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {runsQuery.hasNextPage ? (
                <div>
                  <Button
                    variant="ghost"
                    disabled={runsQuery.isFetchingNextPage}
                    onClick={() => void runsQuery.fetchNextPage()}
                  >
                    {d.loadMore}
                  </Button>
                </div>
              ) : null}
            </section>
          </div>
        ) : null}
      </StateView>
    </div>
  );
}
