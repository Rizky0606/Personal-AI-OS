import { copy } from '../copy';
import { Button } from '../ui/Button';

/** Pengingat di atas kolom tulis: rencana agent siap; Setujui memulai pengerjaan sungguhan. */
export function PlanBanner({ onApprove, disabled }: { onApprove: () => void; disabled: boolean }) {
  return (
    <div className="mx-3 mb-2 flex items-center gap-3 rounded-control border border-border bg-surface px-3 py-2">
      <p className="min-w-0 flex-1 text-ui text-text">{copy.chat.plan.ready}</p>
      <Button variant="primary" disabled={disabled} onClick={onApprove}>
        {copy.chat.plan.approve}
      </Button>
    </div>
  );
}
