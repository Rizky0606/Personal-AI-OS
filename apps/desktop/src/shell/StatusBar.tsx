import { useConnection, useOnline } from '../app/hooks';
import { workerIndicator } from '../worker/status';
import { useWorker } from '../worker/hooks';
import { copy } from '../copy';
import { cn } from '../lib/cn';
import type { ConnectionState } from '../realtime/client';

export interface ConnectionView {
  label: string;
  tone: 'success' | 'warning' | 'muted';
}

/** Status koneksi untuk status bar. Offline perangkat mengalahkan status gateway. */
export function connectionView(connection: ConnectionState, online: boolean): ConnectionView {
  if (!online) return { label: copy.status.offline, tone: 'warning' };
  switch (connection.kind) {
    case 'connected':
      return { label: copy.status.connected, tone: 'success' };
    case 'connecting':
      return { label: copy.status.connecting, tone: 'warning' };
    case 'reconnecting':
      return { label: copy.status.reconnecting, tone: 'warning' };
    case 'idle':
      return { label: copy.status.idle, tone: 'muted' };
  }
}

const dotTone: Record<ConnectionView['tone'], string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  muted: 'bg-text-3',
};

/** Status bar 24px: project dan branch, role, model, worker, kuota, dan status koneksi. */
export function StatusBar() {
  const connection = useConnection();
  const online = useOnline();
  const view = connectionView(connection, online);
  const worker = workerIndicator(useWorker());
  return (
    <footer className="flex h-(--aios-statusbar-height) shrink-0 items-center justify-between border-t border-border bg-surface px-3 font-mono text-caption text-text-2">
      <div className="flex items-center gap-4">
        <span>{copy.status.project}</span>
        <span>{copy.status.role}</span>
        <span>{copy.status.model}</span>
      </div>
      <div className="flex items-center gap-4">
        <span
          role="status"
          aria-label={copy.workerStatus[worker]}
          className="flex items-center gap-2"
        >
          <span
            aria-hidden="true"
            className={cn(
              'size-2 rounded-full',
              worker === 'connected'
                ? 'bg-success'
                : worker === 'reconnecting'
                  ? 'bg-warning'
                  : 'bg-text-3',
            )}
          />
          {copy.workerStatus[worker]}
        </span>
        <span>{copy.status.quota}</span>
        <span role="status" className="flex items-center gap-2">
          <span aria-hidden="true" className={cn('size-2 rounded-full', dotTone[view.tone])} />
          {view.label}
        </span>
      </div>
    </footer>
  );
}
