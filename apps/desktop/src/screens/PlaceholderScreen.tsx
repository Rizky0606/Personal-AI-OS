import { useOnline } from '../app/hooks';
import { copy } from '../copy';
import { ErrorBanner } from '../ui/ErrorBanner';
import { StateView } from '../ui/StateView';

export interface PlaceholderScreenProps {
  emptyMessage: string;
}

/**
 * Layar yang isinya datang di fase berikutnya. Kerangka lima keadaan (memuat, kosong, error, offline, isi)
 * sudah terpasang lewat StateView; saat ini tidak ada sumber data, jadi yang tampil kosong atau pita offline.
 */
export function PlaceholderScreen({ emptyMessage }: PlaceholderScreenProps) {
  const online = useOnline();
  return (
    <div className="flex flex-col">
      {online ? null : <ErrorBanner tone="warning" message={copy.states.offline} className="m-4" />}
      <StateView
        state="empty"
        loadingLabel={copy.states.loading}
        emptyMessage={emptyMessage}
        offlineMessage={copy.states.offline}
        retryLabel={copy.states.retry}
      />
    </div>
  );
}
