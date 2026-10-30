import { Check, ChevronRight, CircleSlash, Loader, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { copy } from '../copy';
import { cn } from '../lib/cn';

export interface ToolStepView {
  name: string;
  target?: string | undefined;
  status: 'running' | 'ok' | 'error' | 'denied' | 'cancelled';
  durationMs?: number | undefined;
}

const statusIcon = {
  running: (
    <Loader size={14} strokeWidth={1.5} aria-hidden="true" className="animate-spin text-accent" />
  ),
  ok: <Check size={14} strokeWidth={1.5} aria-hidden="true" className="text-success" />,
  error: <TriangleAlert size={14} strokeWidth={1.5} aria-hidden="true" className="text-danger" />,
  denied: <CircleSlash size={14} strokeWidth={1.5} aria-hidden="true" className="text-warning" />,
  cancelled: <CircleSlash size={14} strokeWidth={1.5} aria-hidden="true" className="text-text-3" />,
} as const;

/** 1,2 dtk / 340 ms. Angka tabular lewat font-variant-numeric di body. */
export function formatDuration(ms: number): string {
  return ms < 1_000 ? `${ms} ms` : `${(ms / 1_000).toFixed(1).replace('.', ',')} dtk`;
}

const chipClass =
  'inline-flex h-7 max-w-full items-center gap-1.5 rounded-control border border-border bg-surface-2 px-2 font-mono text-meta text-text-2';

/**
 * Chip kecil: ikon status, nama tool, target (dipotong), dan durasi; berderet bersama chip lain. Target
 * panjang bisa dibuka penuh di bawah chip.
 */
export function ToolStepRow({ name, target, status, durationMs }: ToolStepView) {
  const [open, setOpen] = useState(false);
  const label = copy.chat.tool[status];
  const body = (
    <>
      {statusIcon[status]}
      <span className="sr-only">{label}: </span>
      <span className="shrink-0 text-text">{name}</span>
      {target ? (
        <>
          <span className="min-w-0 max-w-48 truncate">{open ? '' : target}</span>
          <ChevronRight
            size={12}
            strokeWidth={1.5}
            aria-hidden="true"
            className={cn(
              'shrink-0 text-text-3 transition-transform duration-[120ms] ease-aios',
              open && 'rotate-90',
            )}
          />
        </>
      ) : null}
      {durationMs !== undefined ? (
        <span className="shrink-0 text-text-3">{formatDuration(durationMs)}</span>
      ) : null}
    </>
  );
  return (
    <div className="flex max-w-full min-w-0 flex-col items-start gap-1">
      {target ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={cn(
            chipClass,
            'text-left transition-colors duration-[120ms] ease-aios hover:border-border-strong hover:text-text',
          )}
        >
          {body}
        </button>
      ) : (
        <span className={chipClass}>{body}</span>
      )}
      {open && target ? (
        <p className="animate-aios-enter max-w-full rounded-control bg-surface-2 px-3 py-2 font-mono text-meta break-all whitespace-pre-wrap text-text">
          {target}
        </p>
      ) : null}
    </div>
  );
}
