import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { apiErrorMessage } from '../api/errors';
import { useScheduleRuns, useSchedules } from '../api/queries';
import { useOnline } from '../app/hooks';
import { copy } from '../copy';
import { cn } from '../lib/cn';
import { formatDateTime } from '../lib/time';
import { enterDelay, Page, PageHeader } from '../screens/PageLayout';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { PageContainer } from '../ui/PageContainer';
import { StateView, type ViewState } from '../ui/StateView';
import { Switch } from '../ui/Switch';
import { useScheduleActions } from './useScheduleActions';

const runHeaderClass = 'px-4 py-3 text-left text-meta font-medium text-text-3';

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
  const { busy, setEnabled, setNotify, runNow, remove } = useScheduleActions();
  const navigate = useNavigate();
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

  const backLink = (
    <Link
      to="/schedules"
      className="flex w-fit items-center gap-1 rounded-control text-ui text-text-2 hover:text-text"
    >
      <ArrowLeft size={14} strokeWidth={1.5} aria-hidden="true" />
      {d.back}
    </Link>
  );

  return (
    <Page width="md">
      <PageHeader
        back={backLink}
        title={schedule ? schedule.name : copy.schedules.title}
        {...(schedule ? { description: `${schedule.cron} · ${schedule.timezone}` } : {})}
      />
      <StateView
        state={view}
        loadingLabel={copy.schedules.loading}
        emptyMessage={copy.errors.notFound}
        emptyAction={
          <Button variant="secondary" onClick={() => void navigate({ to: '/schedules' })}>
            {d.viewAll}
          </Button>
        }
        errorMessage={schedulesQuery.isError ? apiErrorMessage(schedulesQuery.error, online) : ''}
        offlineMessage={copy.states.offline}
        retryLabel={copy.states.retry}
        onRetry={() => void schedulesQuery.refetch()}
      >
        {schedule ? (
          <PageContainer>
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-2">
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
              </div>

              <div className="flex flex-wrap items-center gap-3 rounded-panel border border-border bg-surface p-4">
                <Switch
                  checked={schedule.enabled}
                  disabled={busy === `toggle:${schedule.id}`}
                  label={schedule.enabled ? d.disable : d.enable}
                  onChange={(enabled) => void setEnabled(schedule.id, enabled)}
                />
                <span className="text-ui text-text-2">
                  {schedule.enabled ? copy.schedules.enabled : copy.schedules.disabled}
                </span>
                {schedule.target !== 'research' ? (
                  <>
                    <Switch
                      checked={schedule.notify === 'on_change'}
                      disabled={busy === `notify:${schedule.id}`}
                      label={copy.schedules.notify.label}
                      onChange={(on) => void setNotify(schedule.id, on ? 'on_change' : 'always')}
                    />
                    <span className="text-ui text-text-2" title={copy.schedules.notify.hint}>
                      {copy.schedules.notify.label}
                    </span>
                  </>
                ) : null}
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

              <section className="flex flex-col gap-3">
                <h3 className="text-section font-semibold text-text">{d.history}</h3>
                {runsQuery.isPending ? (
                  <p role="status" className="text-ui text-text-2">
                    {copy.states.loading}
                  </p>
                ) : runsQuery.isError && runs.length === 0 ? (
                  <p role="alert" className="text-ui text-danger">
                    {apiErrorMessage(runsQuery.error, online)}
                  </p>
                ) : runs.length === 0 ? (
                  <EmptyState
                    message={d.historyEmpty}
                    action={
                      <Button
                        variant="secondary"
                        disabled={busy === `run:${schedule.id}`}
                        onClick={() => void runNow(schedule.id)}
                      >
                        {d.runNow}
                      </Button>
                    }
                  />
                ) : (
                  <div className="overflow-hidden rounded-panel border border-border bg-surface">
                    <table aria-label={d.history} className="w-full border-collapse">
                      <thead className="bg-surface-2">
                        <tr>
                          <th scope="col" className={runHeaderClass}>
                            {d.started}
                          </th>
                          <th scope="col" className={runHeaderClass}>
                            {d.finished}
                          </th>
                          <th scope="col" className={runHeaderClass}>
                            {copy.schedules.columns.status}
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {runs.map((run, index) => (
                          <tr
                            key={run.id}
                            style={enterDelay(index)}
                            className="animate-aios-enter transition-colors duration-[120ms] ease-aios hover:bg-surface-2"
                          >
                            <td className="px-4 py-3 text-ui">
                              {formatDateTime(run.startedAt, schedule.timezone)}
                            </td>
                            <td className="px-4 py-3 text-ui text-text-2">
                              {run.finishedAt
                                ? formatDateTime(run.finishedAt, schedule.timezone)
                                : '-'}
                            </td>
                            <td
                              className={cn(
                                'px-4 py-3 text-ui',
                                run.changed === false ? 'text-text-2' : statusTone[run.status],
                              )}
                            >
                              {run.changed === false
                                ? copy.schedules.unchanged
                                : copy.schedules.runStatus[run.status]}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
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
          </PageContainer>
        ) : null}
      </StateView>
    </Page>
  );
}
