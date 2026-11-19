import { copy } from '../copy';
import { useUiStore } from '../state/uiStore';
import { Button } from '../ui/Button';

/**
 * Pengingat di atas kolom tulis: hasil run coding siap ditinjau; tombolnya membuka tab Diff. Run yang dihentikan
 * pemilik di tengah jalan (`endReason: stopped`) diberi tahu bahwa hasilnya mungkin setengah jadi, supaya tidak
 * diterima tanpa sadar.
 */
export function ReviewBanner({ runId, stopped }: { runId: string; stopped: boolean }) {
  const openReview = useUiStore((s) => s.openReview);
  return (
    <div className="mx-3 mb-2 flex items-center gap-3 rounded-control border border-border bg-surface px-3 py-2">
      <p className="min-w-0 flex-1 text-ui text-text">
        {stopped ? copy.review.readyStopped : copy.review.ready}
      </p>
      <Button variant="primary" onClick={() => openReview(runId)}>
        {copy.review.open}
      </Button>
    </div>
  );
}
