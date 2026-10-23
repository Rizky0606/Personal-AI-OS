import { RefreshCw } from 'lucide-react';
import { apiErrorMessage } from '../api/errors';
import { useQuota } from '../api/queries';
import { useOnline } from '../app/hooks';
import { copy } from '../copy';
import { formatCost, formatCount } from '../lib/format';
import { IconButton } from '../ui/IconButton';
import { StateView, type ViewState } from '../ui/StateView';

const headerClass =
  'border-b border-border-strong px-3 py-2 text-left text-meta font-medium text-text-2';
const cellClass = 'border-b border-border px-3 py-1 align-middle text-ui tabular-nums';
const numberCell = `${cellClass} text-right`;

/** Pemakaian dari /quota: total, per model, dan per hari. Angka dari 9Router bila ada, selain itu ringkasan run. */
export function QuotaScreen() {
  const query = useQuota();
  const online = useOnline();
  const quota = query.data;
  const c = copy.quota.columns;

  const view: ViewState = query.isPending
    ? 'loading'
    : query.isError && !quota
      ? online
        ? 'error'
        : 'offline'
      : quota?.totals.requests === 0 && quota.byModel.length === 0
        ? 'empty'
        : 'content';

  // Hari terbaru di atas; batang menunjukkan porsi token terhadap hari terpadat.
  const days = quota ? [...quota.byDay].sort((a, b) => b.date.localeCompare(a.date)) : [];
  const busiest = Math.max(1, ...days.map((d) => d.inputTokens + d.outputTokens));

  return (
    <div className="flex flex-col">
      <div className="flex h-12 items-center justify-between border-b border-border px-4">
        <h2 className="text-section font-semibold text-text">{copy.quota.title}</h2>
        <IconButton label={copy.quota.refresh} onClick={() => void query.refetch()}>
          <RefreshCw size={16} strokeWidth={1.5} aria-hidden="true" />
        </IconButton>
      </div>
      <StateView
        state={view}
        loadingLabel={copy.quota.loading}
        emptyMessage={copy.quota.empty}
        errorMessage={query.isError ? apiErrorMessage(query.error, online) : ''}
        offlineMessage={copy.states.offline}
        retryLabel={copy.states.retry}
        onRetry={() => void query.refetch()}
      >
        {quota ? (
          <div className="flex flex-col gap-6 p-4">
            <p className="text-meta text-text-2">{copy.quota.source[quota.source]}</p>

            <dl
              aria-label={copy.quota.totals}
              className="grid max-w-2xl grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4"
            >
              {[
                [c.requests, formatCount(quota.totals.requests)],
                [c.input, formatCount(quota.totals.inputTokens)],
                [c.output, formatCount(quota.totals.outputTokens)],
                [c.cost, formatCost(quota.totals.costUsd)],
              ].map(([label, value]) => (
                <div key={label} className="flex flex-col">
                  <dt className="text-meta text-text-2">{label}</dt>
                  <dd className="font-mono text-section text-text tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>

            <section aria-labelledby="quota-model" className="flex flex-col gap-2">
              <h3 id="quota-model" className="text-ui font-semibold text-text">
                {copy.quota.byModel}
              </h3>
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th scope="col" className={headerClass}>
                      {c.model}
                    </th>
                    <th scope="col" className={`${headerClass} text-right`}>
                      {c.requests}
                    </th>
                    <th scope="col" className={`${headerClass} text-right`}>
                      {c.input}
                    </th>
                    <th scope="col" className={`${headerClass} text-right`}>
                      {c.output}
                    </th>
                    <th scope="col" className={`${headerClass} text-right`}>
                      {c.cost}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {quota.byModel.map((m) => (
                    <tr key={m.model}>
                      <th scope="row" className={`${cellClass} text-left font-mono font-normal`}>
                        {m.model}
                      </th>
                      <td className={numberCell}>{formatCount(m.requests)}</td>
                      <td className={numberCell}>{formatCount(m.inputTokens)}</td>
                      <td className={numberCell}>{formatCount(m.outputTokens)}</td>
                      <td className={numberCell}>{formatCost(m.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section aria-labelledby="quota-day" className="flex flex-col gap-2">
              <h3 id="quota-day" className="text-ui font-semibold text-text">
                {copy.quota.byDay}
              </h3>
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th scope="col" className={headerClass}>
                      {c.date}
                    </th>
                    <th scope="col" className={`${headerClass} text-right`}>
                      {c.requests}
                    </th>
                    <th scope="col" className={`${headerClass} text-right`}>
                      {c.input}
                    </th>
                    <th scope="col" className={`${headerClass} text-right`}>
                      {c.output}
                    </th>
                    <th scope="col" className={`${headerClass} text-right`}>
                      {c.cost}
                    </th>
                    <th scope="col" className={headerClass}>
                      <span className="sr-only">Porsi token</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((d) => {
                    const total = d.inputTokens + d.outputTokens;
                    return (
                      <tr key={d.date}>
                        <th scope="row" className={`${cellClass} text-left font-mono font-normal`}>
                          {d.date}
                        </th>
                        <td className={numberCell}>{formatCount(d.requests)}</td>
                        <td className={numberCell}>{formatCount(d.inputTokens)}</td>
                        <td className={numberCell}>{formatCount(d.outputTokens)}</td>
                        <td className={numberCell}>{formatCost(d.costUsd)}</td>
                        <td className={`${cellClass} w-32`} aria-hidden="true">
                          <div className="h-1 rounded-badge bg-surface-2">
                            <div
                              className="h-1 rounded-badge bg-accent"
                              style={{ width: `${Math.round((total / busiest) * 100)}%` }}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          </div>
        ) : null}
      </StateView>
    </div>
  );
}
