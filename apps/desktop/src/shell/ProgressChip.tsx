import { ListChecks } from 'lucide-react';
import { useProgressView } from '../chat/useProgressView';
import { copy } from '../copy';
import { useUiStore } from '../state/uiStore';
import { RollNumber } from '../ui/RollNumber';

/**
 * Chip di Topbar layar chat: ikon + "Langkah 7 dari 9" (tabular, angka bergulir 180 ms). Muncul hanya bila ada
 * langkah (rencana agent, atau langkah tool pada mesin tanpa rencana: "Langkah N" tanpa total, tidak dikarang).
 * Klik membuka panel kanan di tab Progres.
 */
export function ProgressChip() {
  const { view } = useProgressView();
  const openPanel = useUiStore((s) => s.openPanel);
  const chip = view.chip;
  if (!chip) return null;
  return (
    <button
      type="button"
      aria-label={copy.progress.chip.label(chip.current, chip.total, chip.label)}
      aria-keyshortcuts="Control+."
      title={copy.progress.openPanel}
      onClick={() => openPanel('progress')}
      className="inline-flex h-7 max-w-48 shrink-0 items-center gap-2 rounded-badge bg-surface-2 px-2 text-meta text-text-2 tabular-nums transition-colors duration-[120ms] ease-aios hover:text-text"
    >
      <ListChecks size={14} strokeWidth={1.5} aria-hidden="true" className="shrink-0" />
      <span className="truncate" aria-hidden="true">
        {copy.progress.chip.word} <RollNumber value={chip.current} />
        {chip.total === null ? null : (
          <>
            {' '}
            {copy.progress.chip.of} {chip.total}
          </>
        )}
      </span>
    </button>
  );
}
