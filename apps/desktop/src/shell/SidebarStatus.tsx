import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Gauge } from 'lucide-react';
import { useState } from 'react';
import { apiErrorMessage } from '../api/errors';
import { useQuota } from '../api/queries';
import { useConnection, useOnline } from '../app/hooks';
import { api } from '../app/services';
import { copy } from '../copy';
import { cn } from '../lib/cn';
import { useUiStore } from '../state/uiStore';
import { Button } from '../ui/Button';
import { useToastStore } from '../ui/Toaster';
import { Tooltip } from '../ui/Tooltip';
import { useProjectWorker, useWorker } from '../worker/hooks';
import { projectWorkerIndicator, workerIndicator } from '../worker/status';
import { connectionView, type ConnectionView } from './connectionView';
import { quotaLabel } from './quotaLabel';

const dotTone: Record<ConnectionView['tone'], string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  muted: 'bg-text-3',
};

/**
 * Kartu status di kaki sidebar: worker, ringkasan kuota, dan koneksi gateway. Dengan project aktif, baris worker
 * menunjukkan worker project itu menurut hub worker gateway (bukan worker lokal), termasuk bila project masih
 * terikat ke worker yang dicabut atau worker lain, beserta tombol untuk memakai worker PC ini.
 */
export function SidebarStatus({ collapsed = false }: { collapsed?: boolean }) {
  const connection = useConnection();
  const online = useOnline();
  const view = connectionView(connection, online);
  const local = useWorker();
  const worker = workerIndicator(local);
  const ownDeviceId = local.status?.deviceId ?? null;
  const activeProjectId = useUiStore((s) => s.activeProjectId);
  const projectWorker = useProjectWorker(activeProjectId).data;
  // Tanpa project aktif, saat memuat, atau saat galat: status worker lokal seperti biasa.
  const projectState =
    activeProjectId !== null && projectWorker
      ? projectWorkerIndicator(projectWorker, ownDeviceId)
      : null;
  const quota = useQuota().data;
  // Null = tidak ada data token: baris kuota disembunyikan (bukan "Kuota 0 token · $0,00").
  const quotaText = quotaLabel(quota);
  const queryClient = useQueryClient();
  const push = useToastStore((s) => s.push);
  const [rebinding, setRebinding] = useState(false);

  const workerLabel =
    projectState === null
      ? copy.workerStatus[worker]
      : projectState === 'other'
        ? copy.projectWorker.other(projectWorker?.name ?? '', projectWorker?.online === true)
        : copy.projectWorker[projectState];
  // Worker lain yang tersambung tetap menjalankan run project ini (mis. project milik PC lain); tombol pindah hanya
  // untuk worker yang dicabut atau worker lain yang offline (mis. worker lama setelah login ulang dengan nama baru).
  const canRebind =
    ownDeviceId !== null &&
    (projectState === 'revoked' || (projectState === 'other' && projectWorker?.online === false));

  async function rebind() {
    if (activeProjectId === null || ownDeviceId === null || rebinding) return;
    setRebinding(true);
    try {
      await api.rebindProjectWorker(activeProjectId, ownDeviceId);
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      push(copy.projectWorker.rebound);
    } catch (e) {
      push(apiErrorMessage(e, online), 'danger');
    } finally {
      setRebinding(false);
    }
  }

  const workerDot = (
    <span
      aria-hidden="true"
      className={cn(
        'size-2 shrink-0 rounded-full',
        projectState === null
          ? worker === 'connected'
            ? 'bg-success'
            : worker === 'reconnecting'
              ? 'animate-aios-breathe bg-warning'
              : 'bg-text-3'
          : projectState === 'connected' || (projectState === 'other' && projectWorker?.online)
            ? 'bg-success'
            : projectState === 'offline'
              ? 'bg-text-3'
              : 'bg-warning',
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
        <Tooltip label={workerLabel}>
          <span
            role="status"
            aria-label={workerLabel}
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
        {quotaText === null ? null : (
          <Tooltip label={quotaText}>
            <Link
              to="/quota"
              aria-label={quotaText}
              className="inline-flex size-8 items-center justify-center rounded-control text-text-2 transition-colors duration-[120ms] ease-aios hover:bg-surface-2 hover:text-text"
            >
              <Gauge size={16} strokeWidth={1.5} aria-hidden="true" />
            </Link>
          </Tooltip>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-control border border-border bg-bg p-2.5 text-meta text-text-2">
      <span role="status" aria-label={workerLabel} className="flex items-center gap-2">
        {workerDot}
        <span className="min-w-0 truncate">{workerLabel}</span>
      </span>
      {canRebind ? (
        <Button disabled={!online || rebinding} onClick={() => void rebind()}>
          {rebinding ? copy.projectWorker.rebinding : copy.projectWorker.useThisPc}
        </Button>
      ) : null}
      {quotaText === null ? null : (
        <Link to="/quota" aria-label={quotaText}>
          {quotaText}
        </Link>
      )}
      <span role="status" className="flex items-center gap-2">
        {connectionDot}
        <span className="min-w-0 truncate">{view.label}</span>
      </span>
    </div>
  );
}
