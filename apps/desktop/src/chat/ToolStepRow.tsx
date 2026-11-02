import { Check, CircleSlash, Loader, TriangleAlert } from 'lucide-react';
import { copy } from '../copy';
import { cn } from '../lib/cn';
import type { ActivityStep } from '../realtime/activity';

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

/**
 * Satu langkah di linimasa aktivitas (hanya tampil saat baris aktivitas dibuka): ikon status, kalimat langkah
 * manusiawi, target redup (dipotong; lengkapnya di tooltip native) dan durasi.
 */
export function ToolStepRow({ step }: { step: ActivityStep }) {
  const label = copy.chat.tool[step.status];
  return (
    <li className="flex min-w-0 items-center gap-2 py-0.5 text-ui text-text-2">
      {statusIcon[step.status]}
      <span className="sr-only">{label}: </span>
      <span className={cn('shrink-0', step.status === 'error' && 'text-danger')}>{step.label}</span>
      {step.target ? (
        <span title={step.target} className="min-w-0 truncate font-mono text-meta text-text-3">
          {step.target}
        </span>
      ) : null}
      {step.durationMs !== null ? (
        <span className="ml-auto shrink-0 font-mono text-meta text-text-3">
          {formatDuration(step.durationMs)}
        </span>
      ) : null}
    </li>
  );
}
