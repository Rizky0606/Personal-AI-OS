import type { Checkpoint } from '@aios/contracts';
import { useState } from 'react';
import { copy } from '../copy';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { EmptyState } from '../ui/EmptyState';

export interface CheckpointListProps {
  checkpoints: Checkpoint[];
  busy: boolean;
  onRestore: (checkpointId: string) => void;
}

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

/** Checkpoint dibuat otomatis setelah setiap langkah agent yang mengubah file; kembali ke mana pun dari daftar ini. */
export function CheckpointList({ checkpoints, busy, onRestore }: CheckpointListProps) {
  const [target, setTarget] = useState<{ id: string; label: string } | null>(null);
  if (checkpoints.length === 0) return <EmptyState message={copy.review.checkpoints.empty} />;

  const entries = [
    ...[...checkpoints].reverse().map((c) => ({ id: c.id, label: c.label, ts: c.ts })),
    { id: 'base', label: copy.review.checkpoints.base, ts: null },
  ];
  return (
    <>
      <ol aria-label={copy.review.checkpoints.listLabel} className="flex flex-col gap-0.5 p-3">
        {entries.map((entry) => (
          <li
            key={entry.id}
            className="flex animate-aios-enter items-center gap-2 rounded-control px-3 py-2 transition-colors duration-[120ms] ease-aios hover:bg-surface-2"
          >
            <span className="min-w-0 flex-1 truncate font-mono text-ui text-text">
              {entry.label}
            </span>
            {entry.ts ? (
              <span className="font-mono text-meta tabular-nums text-text-3">{time(entry.ts)}</span>
            ) : null}
            <Button
              variant="secondary"
              className="h-6 px-2 text-meta"
              disabled={busy}
              aria-label={`${copy.review.checkpoints.restore}: ${entry.label}`}
              onClick={() => setTarget({ id: entry.id, label: entry.label })}
            >
              {copy.review.checkpoints.restore}
            </Button>
          </li>
        ))}
      </ol>
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => !open && setTarget(null)}
        title={copy.review.checkpoints.confirmTitle}
        body={copy.review.checkpoints.confirmBody}
        confirmLabel={copy.review.checkpoints.confirm}
        cancelLabel={copy.review.cancel}
        destructive
        busy={busy}
        onConfirm={() => {
          if (target) onRestore(target.id);
          setTarget(null);
        }}
      />
    </>
  );
}
