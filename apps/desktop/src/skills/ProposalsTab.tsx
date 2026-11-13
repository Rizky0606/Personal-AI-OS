import type { SkillCuratorReport, SkillProposal } from '@aios/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { apiErrorMessage } from '../api/errors';
import { useOnline } from '../app/hooks';
import { api } from '../app/services';
import { copy } from '../copy';
import { useUiStore } from '../state/uiStore';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { StateView, type ViewState } from '../ui/StateView';
import { ProposalReviewDialog } from './ProposalReviewDialog';
import { useSkillActions } from './useSkillActions';

const t = copy.skillsPage.proposals;

const kindLabel = (p: SkillProposal) =>
  p.origin === 'hermes' ? t.kinds.hermes : p.kind === 'patch' ? t.kinds.patch : t.kinds.new;

/** Usulan skill dari agent dan Hermes, plus laporan kurator mingguan. Tidak ada yang aktif sebelum disetujui. */
export function ProposalsTab() {
  const online = useOnline();
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');
  const [openId, setOpenId] = useState<string | null>(null);
  const focus = useUiStore((s) => s.skillsFocus);
  const setFocus = useUiStore((s) => s.setSkillsFocus);
  const list = useQuery({
    queryKey: ['skillProposals', filter, null],
    queryFn: () => api.listSkillProposals({ status: filter }),
  });

  // Dibuka dari kartu di jawaban atau panel Progres: langsung ke tinjauan usulan itu (sekali pakai).
  useEffect(() => {
    if (!focus) return;
    setOpenId(focus.proposalId);
    setFilter('all');
    setFocus(null);
  }, [focus, setFocus]);

  const items = list.data ?? [];
  const state: ViewState = list.isPending
    ? online
      ? 'loading'
      : 'offline'
    : list.isError
      ? online
        ? 'error'
        : 'offline'
      : items.length === 0
        ? 'empty'
        : 'content';

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-[72ch] text-ui text-text-2">{t.intro}</p>
      <CuratorCard />
      <div role="group" aria-label={t.listLabel} className="flex gap-1.5">
        <Chip selected={filter === 'pending'} onClick={() => setFilter('pending')}>
          {t.filterPending}
        </Chip>
        <Chip selected={filter === 'all'} onClick={() => setFilter('all')}>
          {t.filterAll}
        </Chip>
      </div>
      <StateView
        state={state}
        loadingLabel={t.loading}
        emptyMessage={filter === 'pending' ? t.emptyPending : t.emptyAll}
        errorMessage={apiErrorMessage(list.error, online)}
        offlineMessage={copy.states.offline}
        retryLabel={copy.states.retry}
        onRetry={() => void list.refetch()}
        emptyAction={
          <Button onClick={() => void list.refetch()}>{copy.skillsPage.hermes.refresh}</Button>
        }
      >
        <ul
          aria-label={t.listLabel}
          className="flex flex-col rounded-panel border border-border bg-surface"
        >
          {items.map((p) => (
            <li key={p.id} className="border-b border-border last:border-b-0">
              <button
                type="button"
                onClick={() => setOpenId(p.id)}
                className="flex w-full flex-col gap-0.5 px-4 py-2.5 text-left"
              >
                <span className="truncate text-ui font-medium text-text">{p.name}</span>
                <span className="truncate text-meta text-text-2">{p.reason}</span>
                <span className="text-caption text-text-3">
                  {kindLabel(p)} · {t.status[p.status]}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </StateView>
      <ProposalReviewDialog id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

const names = (items: { name: string }[]) => items.map((i) => i.name).join(', ');

function ReportLines({ report }: { report: SkillCuratorReport }) {
  const r = t.report;
  const rows: [string, string][] = [
    [r.mostUsed, report.mostUsed.map((m) => `${m.name} (${r.opens(m.opens)})`).join(', ')],
    [r.neverOpened, names(report.neverOpened)],
    [r.markedStale, names(report.markedStale)],
    [r.archived, names(report.archived)],
    [
      r.merge,
      report.mergeSuggestions
        .map((m) => r.mergeItem(m.a.name, m.b.name, Math.round(m.similarity * 100)))
        .join('; '),
    ],
  ];
  return (
    <dl className="flex flex-col gap-1 text-meta">
      {rows
        .filter(([, value]) => value !== '')
        .map(([label, value]) => (
          <div key={label} className="flex gap-2">
            <dt className="shrink-0 font-medium text-text">{label}:</dt>
            <dd className="min-w-0 text-text-2">{value}</dd>
          </div>
        ))}
    </dl>
  );
}

/** Laporan kurator terakhir dan tombol menjalankannya sekarang (biasanya berjalan mingguan lewat jadwal). */
function CuratorCard() {
  const online = useOnline();
  const { busy, run } = useSkillActions();
  const report = useQuery({
    queryKey: ['skillCurator'],
    queryFn: () => api.getSkillCuratorReport(),
  });
  return (
    <section
      aria-label={t.report.title}
      className="flex flex-col gap-2 rounded-panel border border-border bg-surface p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-ui font-semibold text-text">{t.report.title}</h3>
        <Button
          disabled={!online || busy !== null}
          onClick={() =>
            void run('curator', () => api.runSkillCurator(), t.report.ran).then(() =>
              report.refetch(),
            )
          }
        >
          {busy === 'curator' ? t.report.running : t.report.run}
        </Button>
      </div>
      {report.data ? (
        <>
          <p className="text-caption text-text-3">
            {t.report.generated(new Date(report.data.generatedAt).toLocaleString('id-ID'))}
          </p>
          <ReportLines report={report.data} />
        </>
      ) : (
        <p className="text-meta text-text-2">{t.report.empty}</p>
      )}
    </section>
  );
}
