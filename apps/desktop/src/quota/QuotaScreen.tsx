import { RefreshCw } from 'lucide-react';
import { useNavigate } from '@tanstack/react-router';
import { apiErrorMessage } from '../api/errors';
import { useQuota } from '../api/queries';
import { useOnline } from '../app/hooks';
import { copy } from '../copy';
import { formatCost, formatCount } from '../lib/format';
import { Page, PageHeader } from '../screens/PageLayout';
import { IconButton } from '../ui/IconButton';
import { useUiStore } from '../state/uiStore';
import { Button } from '../ui/Button';
import { StateView, type ViewState } from '../ui/StateView';

const headerClass =
  'border-b border-border px-4 py-2.5 text-left text-meta font-medium text-text-3';
const cellClass = 'border-b border-border px-4 py-3 align-middle text-ui tabular-nums';
const numberCell = `${cellClass} text-right`;
const rowClass = 'transition-colors duration-[120ms] ease-aios hover:bg-surface-2';
const panelClass = 'overflow-hidden rounded-panel border border-border bg-surface';

/** Pemakaian dari /quota: total, per model, dan per hari. Angka dari 9Router bila ada, selain itu ringkasan run. */
export function QuotaScreen() {
  const query = useQuota();
  const online = useOnline();
  const navigate = useNavigate();
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
  // Gateway belum mencatat biaya (costUsd selalu 0): kolom dan total Biaya hanya tampil bila ada nilai > 0.
  const showCost =
    !!quota &&
    (quota.totals.costUsd > 0 ||
      quota.byModel.some((m) => m.costUsd > 0) ||
      quota.byDay.some((d) => d.costUsd > 0));

  return (
    <Page>
      <PageHeader
        title={copy.quota.title}
        description={copy.quota.description}
        actions={
          <IconButton label={copy.quota.refresh} onClick={() => void query.refetch()}>
            <RefreshCw size={16} strokeWidth={1.5} aria-hidden="true" />
          </IconButton>
        }
      />
      <StateView
        state={view}
        loadingLabel={copy.quota.loading}
        emptyMessage={copy.quota.empty}
        errorMessage={query.isError ? apiErrorMessage(query.error, online) : ''}
        offlineMessage={copy.states.offline}
        retryLabel={copy.states.retry}
        onRetry={() => void query.refetch()}
        emptyAction={
          <Button
            variant="secondary"
            onClick={() => {
              useUiStore.getState().requestNewChat();
              void navigate({ to: '/' });
            }}
          >
            {copy.chat.startConversation}
          </Button>
        }
      >
        {quota ? (
          <div className="flex animate-aios-enter flex-col gap-6">
            <p className="text-meta text-text-2">{copy.quota.source[quota.source]}</p>

            <dl aria-label={copy.quota.totals} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                [c.requests, formatCount(quota.totals.requests)],
                [c.input, formatCount(quota.totals.inputTokens)],
                [c.output, formatCount(quota.totals.outputTokens)],
                ...(showCost ? [[c.cost, formatCost(quota.totals.costUsd)]] : []),
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="flex flex-col gap-1 rounded-panel border border-border bg-surface p-4"
                >
                  <dt className="text-meta text-text-2">{label}</dt>
                  <dd className="font-mono text-page text-text tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>

            <section aria-labelledby="quota-model" className="flex flex-col gap-3">
              <h3 id="quota-model" className="text-section font-semibold text-text">
                {copy.quota.byModel}
              </h3>
              <div className={panelClass}>
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
                      {showCost ? (
                        <th scope="col" className={`${headerClass} text-right`}>
                          {c.cost}
                        </th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {quota.byModel.map((m) => (
                      <tr key={m.model} className={rowClass}>
                        <th scope="row" className={`${cellClass} text-left font-mono font-normal`}>
                          {m.model}
                        </th>
                        <td className={numberCell}>{formatCount(m.requests)}</td>
                        <td className={numberCell}>{formatCount(m.inputTokens)}</td>
                        <td className={numberCell}>{formatCount(m.outputTokens)}</td>
                        {showCost ? <td className={numberCell}>{formatCost(m.costUsd)}</td> : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section aria-labelledby="quota-day" className="flex flex-col gap-3">
              <h3 id="quota-day" className="text-section font-semibold text-text">
                {copy.quota.byDay}
              </h3>
              <div className={panelClass}>
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
                      {showCost ? (
                        <th scope="col" className={`${headerClass} text-right`}>
                          {c.cost}
                        </th>
                      ) : null}
                      <th scope="col" className={headerClass}>
                        <span className="sr-only">Porsi token</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {days.map((d) => {
                      const total = d.inputTokens + d.outputTokens;
                      return (
                        <tr key={d.date} className={rowClass}>
                          <th
                            scope="row"
                            className={`${cellClass} text-left font-mono font-normal`}
                          >
                            {d.date}
                          </th>
                          <td className={numberCell}>{formatCount(d.requests)}</td>
                          <td className={numberCell}>{formatCount(d.inputTokens)}</td>
                          <td className={numberCell}>{formatCount(d.outputTokens)}</td>
                          {showCost ? (
                            <td className={numberCell}>{formatCost(d.costUsd)}</td>
                          ) : null}
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
              </div>
            </section>
          </div>
        ) : null}
      </StateView>
    </Page>
  );
}
