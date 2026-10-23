import { copy } from '../copy';
import { useUiStore } from '../state/uiStore';
import { EmptyState } from '../ui/EmptyState';
import { ReviewView } from './ReviewView';

/** Isi tab Diff di panel kanan: hasil run coding yang menunggu tinjauan, atau petunjuk bila belum ada. */
export function DiffPanel() {
  const runId = useUiStore((s) => s.reviewRunId);
  if (runId === null) return <EmptyState message={copy.review.empty} />;
  // Dikunci per run supaya komentar dan pilihan tidak terbawa ke run lain.
  return <ReviewView key={runId} runId={runId} />;
}
