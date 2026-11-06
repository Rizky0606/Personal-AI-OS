import type { ProgressOutput } from '@aios/contracts';
import { useNavigate } from '@tanstack/react-router';
import { WifiOff } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { apiErrorMessage } from '../api/errors';
import { useConversation, useTeam } from '../api/queries';
import { api } from '../app/services';
import { ArtifactLightbox, type LightboxFile } from '../chat/ArtifactLightbox';
import { useProgressView } from '../chat/useProgressView';
import { copy } from '../copy';
import { saveBlob } from '../lib/external';
import { useUiStore } from '../state/uiStore';
import { Button } from '../ui/Button';
import { StateView, type ViewState } from '../ui/StateView';
import { useToastStore } from '../ui/Toaster';
import { OutputCards } from './OutputCards';
import { ProgressTimeline } from './ProgressTimeline';
import { TeamProgressTree } from './TeamProgressTree';
import { UsedSection, hasUsed } from './UsedSection';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-caption font-semibold tracking-wide text-text-3 uppercase">{title}</h3>
      {children}
    </section>
  );
}

/** Mengarahkan fokus ke kolom pesan (aksi di keadaan kosong). */
const focusComposer = () => document.querySelector<HTMLElement>('[data-composer-field]')?.focus();

/**
 * Tab Progres di panel kanan: (1) linimasa rencana agent, (2) kartu Output, (3) "Digunakan dalam sesi ini".
 * Empat keadaan: memuat (kerangka), kosong, error (Coba lagi), dan isi; offline menampilkan data terakhir dengan tanda.
 */
export function ProgressPanel() {
  const state = useProgressView();
  const { view, offline } = state;
  const phase = state.phase;
  const navigate = useNavigate();
  const push = useToastStore((s) => s.push);
  const openReview = useUiStore((s) => s.openReview);
  const conversationId = useUiStore((s) => s.progressSource?.conversationId);
  const [lightbox, setLightbox] = useState<LightboxFile | null>(null);
  const conversation = useConversation(conversationId);
  const teamId = conversation.data?.teamId ?? null;
  const team = useTeam(teamId);

  async function cancelMember(memberId: string) {
    if (!teamId) return;
    try {
      await api.cancelTeamMember(teamId, memberId);
    } catch (error) {
      push(`${copy.chat.team.cancelFailed} ${apiErrorMessage(error, !offline)}`, 'danger');
    }
  }

  const hasData =
    !!team.data || view.steps.length > 0 || view.outputs.length > 0 || hasUsed(view.used);
  const viewState: ViewState = !state.hasSource
    ? 'empty'
    : state.loading && !hasData
      ? 'loading'
      : state.error && !hasData
        ? offline
          ? 'offline'
          : 'error'
        : hasData
          ? 'content'
          : 'empty';

  async function openOutput(output: ProgressOutput) {
    if (output.kind === 'image') return setLightbox(output);
    if (output.kind === 'diff') return openReview(output.runId);
    if (output.kind === 'research')
      return void navigate({
        to: '/research/$researchId',
        params: { researchId: output.researchId },
      });
    try {
      saveBlob(await api.downloadFile(output.fileId), output.name);
    } catch (error) {
      push(apiErrorMessage(error, !offline), 'danger');
    }
  }

  return (
    <section
      aria-label={copy.progress.region}
      className="flex h-full min-h-0 flex-col gap-5 overflow-y-auto p-4"
    >
      {offline && hasData ? (
        <p
          role="status"
          className="flex items-center gap-2 rounded-control bg-surface-2 px-3 py-2 text-meta text-text-2"
        >
          <WifiOff size={14} strokeWidth={1.5} aria-hidden="true" />
          {copy.progress.offline}
        </p>
      ) : null}
      <StateView
        state={viewState}
        loadingLabel={copy.progress.loading}
        emptyMessage={copy.progress.empty}
        errorMessage={state.errorMessage}
        offlineMessage={copy.states.offline}
        retryLabel={copy.states.retry}
        onRetry={state.refetch}
        emptyAction={
          <Button variant="secondary" onClick={focusComposer}>
            {copy.progress.emptyAction}
          </Button>
        }
      >
        <Section title={copy.progress.sections.progress}>
          {team.data ? (
            <TeamProgressTree team={team.data} onCancelMember={(id) => void cancelMember(id)} />
          ) : view.steps.length > 0 ? (
            <ProgressTimeline steps={view.steps} phase={phase} />
          ) : (
            <p className="text-ui text-text-2">{copy.progress.noSteps}</p>
          )}
        </Section>
        {view.outputs.length > 0 ? (
          <Section title={copy.progress.sections.outputs}>
            <OutputCards outputs={view.outputs} onOpen={(o) => void openOutput(o)} />
          </Section>
        ) : null}
        {hasUsed(view.used) ? (
          <Section title={copy.progress.sections.used}>
            <UsedSection used={view.used} />
          </Section>
        ) : null}
      </StateView>
      {lightbox ? <ArtifactLightbox file={lightbox} onClose={() => setLightbox(null)} /> : null}
    </section>
  );
}
