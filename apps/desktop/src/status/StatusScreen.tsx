import { RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { apiErrorMessage } from '../api/errors';
import { useSystemStatus } from '../api/queries';
import { useOnline } from '../app/hooks';
import { copy } from '../copy';
import { cn } from '../lib/cn';
import { formatDateTime } from '../lib/time';
import { IconButton } from '../ui/IconButton';
import { Button } from '../ui/Button';
import { PageContainer } from '../ui/PageContainer';
import { PageHeader } from '../ui/PageHeader';
import { StateView, type ViewState } from '../ui/StateView';
import { useWorker } from '../worker/hooks';

const p = copy.status.page;
const headerClass =
  'border-b border-border-strong px-3 py-2 text-left text-meta font-medium text-text-2';
const cellClass = 'border-b border-border px-3 py-1 align-middle text-ui';

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h3 id={id} className="text-ui font-semibold text-text">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Rows({ rows }: { rows: [label: string, value: ReactNode][] }) {
  return (
    <dl className="flex flex-col">
      {rows.map(([label, value]) => (
        <div
          key={label}
          className="grid grid-cols-[12rem_1fr] gap-3 border-b border-border py-1.5 text-ui"
        >
          <dt className="text-text-2">{label}</dt>
          <dd className="min-w-0 break-words font-mono text-text">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Titik + teks, supaya status tidak hanya dibedakan oleh warna. */
function Dot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 font-sans">
      <span
        aria-hidden="true"
        className={cn('size-2 rounded-full', ok ? 'bg-success' : 'bg-danger')}
      />
      {label}
    </span>
  );
}

function uptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days} hari ${hours} jam`;
  if (hours > 0) return `${hours} jam ${minutes} menit`;
  return `${minutes} menit`;
}

/** Halaman Status: versi, dependensi, worker, dan antrean job. Disegarkan tiap 15 detik. */
export function StatusScreen() {
  const query = useSystemStatus();
  const online = useOnline();
  const worker = useWorker();
  const status = query.data;

  const view: ViewState = query.isPending
    ? 'loading'
    : query.isError && !status
      ? online
        ? 'error'
        : 'offline'
      : 'content';

  return (
    <div className="flex flex-col">
      <PageHeader
        title={p.title}
        secondary={
          <IconButton label={p.refresh} onClick={() => void query.refetch()}>
            <RefreshCw size={16} strokeWidth={1.5} aria-hidden="true" />
          </IconButton>
        }
      />
      <StateView
        state={view}
        loadingLabel={p.loading}
        emptyMessage={p.loading}
        errorMessage={query.isError ? apiErrorMessage(query.error, online) : ''}
        offlineMessage={copy.states.offline}
        retryLabel={copy.states.retry}
        onRetry={() => void query.refetch()}
        emptyAction={
          <Button variant="secondary" onClick={() => void query.refetch()}>
            {p.refresh}
          </Button>
        }
      >
        {status ? (
          <PageContainer>
            <p role="status" className="text-ui text-text-2">
              {p.overall[status.readiness.status]}
            </p>

            <Section id="st-gateway" title={p.gateway}>
              <Rows
                rows={[
                  [p.version, status.gateway.version],
                  [p.adapters, status.gateway.adaptersVersion],
                  [p.node, status.gateway.node],
                  [p.uptime, uptime(status.gateway.uptimeSec)],
                  [p.activeRuns, String(status.activeRuns)],
                ]}
              />
            </Section>

            <Section id="st-deps" title={p.dependencies}>
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th scope="col" className={headerClass}>
                      {p.dependencies}
                    </th>
                    <th scope="col" className={headerClass}>
                      {copy.status.statusColumn}
                    </th>
                    <th scope="col" className={`${headerClass} text-right`}>
                      {p.latency}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(Object.keys(status.readiness.checks) as (keyof typeof p.deps)[]).map((name) => {
                    const check = status.readiness.checks[name];
                    return (
                      <tr key={name}>
                        <th scope="row" className={`${cellClass} text-left font-normal`}>
                          {p.deps[name]}
                        </th>
                        <td className={cellClass}>
                          <Dot
                            ok={check.ok}
                            label={
                              check.ok ? p.ok : `${p.down}${check.error ? ` (${check.error})` : ''}`
                            }
                          />
                        </td>
                        <td className={`${cellClass} text-right font-mono tabular-nums`}>
                          {check.latencyMs === undefined ? '-' : `${check.latencyMs} ms`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Section>

            <Section id="st-workers" title={p.workers}>
              <Rows
                rows={[
                  [
                    `${p.thisPc} · ${p.local}`,
                    <Dot
                      key="local"
                      ok={worker.local === 'connected'}
                      label={worker.local === 'connected' ? p.localOn : p.localOff}
                    />,
                  ],
                  [p.workerVersion, worker.status?.version ?? '-'],
                  [p.ompVersion, worker.status?.ompVersion ?? p.notInstalled],
                  [p.browser, worker.status?.browserAvailable ? p.browserYes : p.browserNo],
                ]}
              />
              {status.workers.length === 0 ? (
                <p className="text-ui text-text-2">{p.noWorkers}</p>
              ) : (
                <ul className="flex flex-col">
                  {status.workers.map((w) => (
                    <li
                      key={w.deviceId}
                      className="flex items-center justify-between gap-3 border-b border-border py-1.5 text-ui"
                    >
                      <span className="min-w-0 truncate text-text">{w.name}</span>
                      <span className="flex shrink-0 items-center gap-4 text-text-2">
                        <Dot ok={w.online} label={w.online ? p.online : p.offline} />
                        <span className="text-meta">
                          {p.lastSeen}: {w.lastSeenAt ? formatDateTime(w.lastSeenAt) : p.never}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section id="st-jobs" title={p.jobs}>
              {status.jobs.length === 0 ? (
                <p className="text-ui text-text-2">{p.noJobs}</p>
              ) : (
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th scope="col" className={headerClass}>
                        {p.queue}
                      </th>
                      <th scope="col" className={`${headerClass} text-right`}>
                        {p.queued}
                      </th>
                      <th scope="col" className={`${headerClass} text-right`}>
                        {p.active}
                      </th>
                      <th scope="col" className={`${headerClass} text-right`}>
                        {p.failed}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {status.jobs.map((q) => (
                      <tr key={q.queue}>
                        <th scope="row" className={`${cellClass} text-left font-mono font-normal`}>
                          {q.queue}
                        </th>
                        <td className={`${cellClass} text-right tabular-nums`}>{q.queued}</td>
                        <td className={`${cellClass} text-right tabular-nums`}>{q.active}</td>
                        <td
                          className={cn(
                            cellClass,
                            'text-right tabular-nums',
                            q.failed > 0 && 'text-danger',
                          )}
                        >
                          {q.failed}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Section>
          </PageContainer>
        ) : null}
      </StateView>
    </div>
  );
}
