import { useNavigate } from '@tanstack/react-router';
import { copy } from '../copy';
import { useUiStore } from '../state/uiStore';
import { EmptyState } from '../ui/EmptyState';
import { Button } from '../ui/Button';
import { ReviewView } from './ReviewView';

/** Isi tab Diff di panel kanan: hasil run coding yang menunggu tinjauan, atau petunjuk bila belum ada. */
export function DiffPanel() {
  const runId = useUiStore((s) => s.reviewRunId);
  const navigate = useNavigate();
  if (runId === null) {
    return (
      <EmptyState
        message={copy.review.empty}
        action={
          <Button variant="secondary" onClick={() => void navigate({ to: '/kanban' })}>
            {copy.review.openKanban}
          </Button>
        }
      />
    );
  }
  // Dikunci per run supaya komentar dan pilihan tidak terbawa ke run lain.
  return <ReviewView key={runId} runId={runId} />;
}
