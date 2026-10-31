import { Link } from '@tanstack/react-router';
import { Gauge } from 'lucide-react';
import { useQuota } from '../api/queries';
import { useConnection, useOnline } from '../app/hooks';
import { copy } from '../copy';
import { formatCost, formatTokens } from '../lib/format';
import { cn } from '../lib/cn';
import { Tooltip } from '../ui/Tooltip';
import { useWorker } from '../worker/hooks';
import { workerIndicator } from '../worker/status';
import { connectionView, type ConnectionView } from './connectionView';

const dotTone: Record<ConnectionView['tone'], string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  muted: 'bg-text-3',
};

/** Kartu status di kaki sidebar: worker di PC ini, ringkasan kuota, dan koneksi gateway. */
export function SidebarStatus({ collapsed = false }: { collapsed?: boolean }) {
  const connection = useConnection();
  const online = useOnline();
  const view = connectionView(connection, online);
  const worker = workerIndicator(useWorker());
  const quota = useQuota().data;
  const quotaLabel = quota
    ? copy.status.quotaSummary(
        formatTokens(quota.totals.inputTokens + quota.totals.outputTokens),
        formatCost(quota.totals.costUsd),
      )
    : copy.status.quotaTokens('0');

  const workerDot = (
    <span
      aria-hidden="true"
      className={cn(
        'size-2 shrink-0 rounded-full',
        worker === 'connected'
          ? 'bg-success'
          : worker === 'reconnecting'
            ? 'animate-aios-breathe bg-warning'
            : 'bg-text-3',
      )}
    />
  );
  const connectionDot = (
    <span
      aria-hidden="true"
      className={cn(
        'size-2 shrink-0 rounded-full',
        dotTone[view.tone],
        view.tone === 'warning' && 'animate-aios-breathe',
      )}
    />
  );

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-3 py-1">
        <Tooltip label={copy.workerStatus[worker]}>
          <span
            role="status"
            aria-label={copy.workerStatus[worker]}
            className="inline-flex size-6 items-center justify-center"
          >
            {workerDot}
          </span>
        </Tooltip>
        <Tooltip label={view.label}>
          <span
            role="status"
            aria-label={view.label}
            className="inline-flex size-6 items-center justify-center"
          >
            {connectionDot}
          </span>
        </Tooltip>
        <Tooltip label={quotaLabel}>
          <Link
            to="/quota"
            aria-label={quotaLabel}
            className="inline-flex size-8 items-center justify-center rounded-control text-text-2 transition-colors duration-[120ms] ease-aios hover:bg-surface-2 hover:text-text"
          >
            <Gauge size={16} strokeWidth={1.5} aria-hidden="true" />
          </Link>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-control border border-border bg-bg p-2.5 text-meta text-text-2">
      <span
        role="status"
        aria-label={copy.workerStatus[worker]}
        className="flex items-center gap-2"
      >
        {workerDot}
        <span className="min-w-0 truncate">{copy.workerStatus[worker]}</span>
      </span>
      <Link to="/quota" aria-label={quotaLabel}>
        {quotaLabel}
      </Link>
      <span role="status" className="flex items-center gap-2">
        {connectionDot}
        <span className="min-w-0 truncate">{view.label}</span>
      </span>
    </div>
  );
}
