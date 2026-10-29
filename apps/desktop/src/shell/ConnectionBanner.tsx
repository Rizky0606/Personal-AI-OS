import { WifiOff } from 'lucide-react';
import { useConnection, useOnline } from '../app/hooks';
import { realtime } from '../app/services';
import { copy } from '../copy';
import { Button } from '../ui/Button';
import { ErrorBanner } from '../ui/ErrorBanner';

/**
 * Keadaan shell yang bukan "sukses": perangkat luring (informasi, tanpa tombol karena tidak ada yang bisa dicoba)
 * dan gateway tidak terjangkau saat perangkat online (galat, dengan tombol Coba lagi yang menyambung ulang
 * seketika). Saat tersambung tidak ada yang ditampilkan.
 */
export function ConnectionBanner() {
  const connection = useConnection();
  const online = useOnline();

  if (!online) {
    return (
      <div className="shrink-0 px-4 pt-3">
        <div
          role="status"
          className="flex items-center gap-3 rounded-control border border-warning bg-surface p-3"
        >
          <WifiOff
            size={16}
            strokeWidth={1.5}
            aria-hidden="true"
            className="shrink-0 text-warning"
          />
          <p className="min-w-0 flex-1 text-ui text-text">{copy.shell.offlineBanner}</p>
        </div>
      </div>
    );
  }
  if (connection.kind !== 'reconnecting') return null;
  return (
    <div className="shrink-0 px-4 pt-3">
      <ErrorBanner
        message={copy.shell.gatewayError}
        action={
          <Button variant="secondary" onClick={() => realtime.reconnectNow()}>
            {copy.states.retry}
          </Button>
        }
      />
    </div>
  );
}
