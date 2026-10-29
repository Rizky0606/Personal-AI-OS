import { useEffect, useMemo } from 'react';
import { apiErrorMessage } from '../api/errors';
import { useResearchJob } from '../api/queries';
import { useLiveRun, useOnline } from '../app/hooks';
import { runs } from '../app/services';
import { copy } from '../copy';
import { Markdown } from '../markdown/Markdown';
import { Page, PageHeader } from '../screens/PageLayout';
import { Button } from '../ui/Button';
import { ErrorBanner } from '../ui/ErrorBanner';
import { StateView, type ViewState } from '../ui/StateView';
import { parseReport } from './reportParser';
import { ResearchProgress } from './ResearchProgress';
import { SourceList, type SourceItem } from './SourceList';
import { useResearchActions } from './useResearchActions';

/**
 * Satu job riset. Job berjalan di server, jadi layar ini hanya mengamati: membuka ulang berlangganan
 * `run:<id>` dari seq 0 dan seluruh tahap serta sumber sampai saat ini diputar ulang.
 */
export function ResearchDetailScreen({ researchId }: { researchId: string }) {
  const query = useResearchJob(researchId);
  const online = useOnline();
  const { busy, cancel, exportReport } = useResearchActions();
  const job = query.data;
  const running = job?.status === 'queued' || job?.status === 'running';

  useEffect(() => {
    if (running && job?.runId) runs.track(job.runId);
  }, [running, job?.runId]);

  const live = useLiveRun(job?.runId);
  const report = useMemo(
    () => (job?.reportMd?.trim() ? parseReport(job.reportMd) : null),
    [job?.reportMd],
  );

  const sources = useMemo<SourceItem[]>(() => {
    if (report && report.sources.length > 0) {
      return report.sources.map((s) => ({
        key: `${s.n}-${s.url}`,
        n: s.n,
        title: s.title,
        url: s.url,
        ...(s.meta ? { meta: s.meta } : {}),
      }));
    }
    const known = new Set<string>();
    const merged: SourceItem[] = [];
    for (const s of [...(job?.sources ?? []), ...(live?.sources ?? [])]) {
      if (known.has(s.url)) continue;
      known.add(s.url);
      merged.push({ key: s.url, title: s.title, url: s.url });
    }
    return merged;
  }, [report, job?.sources, live?.sources]);

  const view: ViewState = query.isPending
    ? 'loading'
    : query.isError && !job
      ? online
        ? 'error'
        : 'offline'
      : 'content';

  const failureMessage = live?.error?.message;
  const subQuestions = job?.plan?.subQuestions ?? [];

  return (
    <StateView
      state={view}
      loadingLabel={copy.states.loading}
      emptyMessage=""
      errorMessage={query.isError ? apiErrorMessage(query.error, online) : ''}
      offlineMessage={copy.states.offline}
      retryLabel={copy.states.retry}
      onRetry={() => void query.refetch()}
    >
      {job ? (
        <Page width="md">
          <PageHeader
            title={job.question}
            description={`${copy.research.status[job.status]} · ${copy.research.form.depths[job.depth]}`}
            actions={
              <>
                {running ? (
                  <Button
                    variant="secondary"
                    disabled={busy === 'cancel'}
                    onClick={() => void cancel(job.id)}
                  >
                    {busy === 'cancel' ? copy.research.cancelling : copy.research.cancel}
                  </Button>
                ) : null}
                {job.status === 'completed' ? (
                  <>
                    <Button
                      variant="secondary"
                      disabled={busy === 'md'}
                      onClick={() => void exportReport(job.id, 'md')}
                    >
                      {busy === 'md' ? copy.research.exporting : copy.research.exportMd}
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={busy === 'pdf'}
                      onClick={() => void exportReport(job.id, 'pdf')}
                    >
                      {busy === 'pdf' ? copy.research.exporting : copy.research.exportPdf}
                    </Button>
                  </>
                ) : null}
              </>
            }
          />

          {job.status === 'failed' || failureMessage ? (
            <ErrorBanner message={`${copy.research.failedTitle} ${failureMessage ?? ''}`.trim()} />
          ) : null}

          {running ? (
            <ResearchProgress
              stage={live?.research.stage ?? null}
              progress={live?.research.progress ?? 0}
              message={live?.research.message}
            />
          ) : null}

          {subQuestions.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h3 className="text-chat font-semibold text-text">{copy.research.plan}</h3>
              <ol className="list-decimal rounded-panel border border-border bg-surface py-3 pr-4 pl-9 text-ui text-text-2">
                {subQuestions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ol>
            </section>
          ) : null}

          {report ? (
            <section aria-label={copy.research.report} className="max-w-[72ch]">
              <Markdown source={report.bodyMd} citations={report.citations} />
            </section>
          ) : running || job.status === 'queued' ? null : (
            <p className="text-ui text-text-2">{copy.research.reportEmpty}</p>
          )}

          <section className="flex flex-col gap-2">
            <h3 className="text-chat font-semibold text-text">{copy.research.sources}</h3>
            {sources.length > 0 ? (
              <SourceList items={sources} />
            ) : (
              <p className="text-ui text-text-2">{copy.research.sourcesEmpty}</p>
            )}
          </section>
        </Page>
      ) : null}
    </StateView>
  );
}
