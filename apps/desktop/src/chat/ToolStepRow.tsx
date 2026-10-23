import { Check, ChevronRight, CircleSlash, Loader, TriangleAlert, Wrench } from 'lucide-react';
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
  running: <Loader size={14} strokeWidth={1.5} aria-hidden="true" className="text-accent" />,
  ok: <Check size={14} strokeWidth={1.5} aria-hidden="true" className="text-success" />,
  error: <TriangleAlert size={14} strokeWidth={1.5} aria-hidden="true" className="text-danger" />,
  denied: <CircleSlash size={14} strokeWidth={1.5} aria-hidden="true" className="text-warning" />,
  cancelled: <CircleSlash size={14} strokeWidth={1.5} aria-hidden="true" className="text-text-3" />,
} as const;

/** 1,2 dtk / 340 ms. Angka tabular lewat font-variant-numeric di body. */
export function formatDuration(ms: number): string {
  return ms < 1_000 ? `${ms} ms` : `${(ms / 1_000).toFixed(1).replace('.', ',')} dtk`;
}

/** Satu baris mono: ikon, nama tool, target, status, durasi. Target panjang bisa dibuka penuh. */
export function ToolStepRow({ name, target, status, durationMs }: ToolStepView) {
  const [open, setOpen] = useState(false);
  const label = copy.chat.tool[status];
  return (
    <div className="font-mono text-ui text-text-2">
      <div className="flex min-h-6 items-center gap-2">
        <Wrench size={14} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-text-3" />
        <span className="shrink-0 text-text">{name}</span>
        {target ? (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="flex min-w-0 items-center gap-1 rounded-badge text-left hover:text-text"
          >
            <ChevronRight
              size={12}
              strokeWidth={1.5}
              aria-hidden="true"
              className={cn('shrink-0 transition-transform duration-[120ms]', open && 'rotate-90')}
            />
            <span className={cn('min-w-0', !open && 'truncate')}>{open ? '' : target}</span>
          </button>
        ) : null}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {statusIcon[status]}
          <span>{label}</span>
          {durationMs !== undefined ? (
            <span className="text-text-3">{formatDuration(durationMs)}</span>
          ) : null}
        </span>
      </div>
      {open && target ? (
        <p className="pb-1 pl-6 break-all whitespace-pre-wrap text-text">{target}</p>
      ) : null}
    </div>
  );
}
