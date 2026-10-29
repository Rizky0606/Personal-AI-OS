import { copy } from '../copy';
import { Button } from '../ui/Button';

/** Pengingat di atas kolom tulis: rencana agent siap; Setujui memulai pengerjaan sungguhan. */
export function PlanBanner({ onApprove, disabled }: { onApprove: () => void; disabled: boolean }) {
  return (
    <div className="mx-auto mt-2 flex w-[calc(100%-4rem)] max-w-[calc(var(--aios-chat-measure)+2.5rem)] shrink-0 animate-aios-enter items-center gap-3 rounded-panel border border-accent bg-accent-soft px-4 py-2.5">
      <p className="min-w-0 flex-1 text-ui text-text">{copy.chat.plan.ready}</p>
      <Button variant="primary" disabled={disabled} onClick={onApprove}>
        {copy.chat.plan.approve}
      </Button>
    </div>
  );
}
