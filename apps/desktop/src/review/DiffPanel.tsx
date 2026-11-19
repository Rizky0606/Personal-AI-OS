import { useNavigate, useRouterState } from '@tanstack/react-router';
import { copy } from '../copy';
import { useUiStore } from '../state/uiStore';
import { EmptyState } from '../ui/EmptyState';
import { Button } from '../ui/Button';
import { ReviewView } from './ReviewView';

/**
 * Isi tab Diff di panel kanan: hasil run coding yang menunggu tinjauan, atau petunjuk bila belum ada. Di layar chat
 * (umum atau project) hasil datang dari pesan di sini, jadi aksinya menulis pesan; di layar lain membuka papan kartu.
 */
export function DiffPanel() {
  const runId = useUiStore((s) => s.reviewRunId);
  const navigate = useNavigate();
  // Chat umum (/, /chat/…) atau chat project (/workspace/<id>[/<percakapan>]), termasuk chat baru.
  const inChat = useRouterState({
    select: (s) => /^\/($|chat|workspace\/[^/]+)/.test(s.location.pathname),
  });
  if (runId === null) {
    return (
      <EmptyState
        message={inChat ? copy.review.emptyChat : copy.review.empty}
        action={
          inChat ? (
            <Button
              variant="secondary"
              onClick={() => document.querySelector<HTMLElement>('[data-composer-field]')?.focus()}
            >
              {copy.review.writeMessage}
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => void navigate({ to: '/kanban' })}>
              {copy.review.openKanban}
            </Button>
          )
        }
      />
    );
  }
  // Dikunci per run supaya komentar dan pilihan tidak terbawa ke run lain.
  return <ReviewView key={runId} runId={runId} />;
}
