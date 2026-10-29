import type { ReviewState } from '@aios/contracts';
import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import { copy } from '../copy';
import { Button } from '../ui/Button';
import { Switch } from '../ui/Switch';
import { TextField } from '../ui/TextField';

export interface AcceptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: ReviewState;
  busy: boolean;
  onAccept: (options: { merge: boolean; commitMessage: string }) => void;
}

/** Terima: pesan commit (usulan agent, bisa diubah) dan pilihan menggabungkan ke branch kerja atau membiarkan sebagai branch. */
export function AcceptDialog({ open, onOpenChange, state, busy, onAccept }: AcceptDialogProps) {
  const [message, setMessage] = useState(state.commitMessage);
  const [merge, setMerge] = useState(false);
  const [touched, setTouched] = useState(false);
  const target = state.targetBranch;
  const empty = message.trim() === '';

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 animate-aios-fade bg-bg/60" />
        <Dialog.Content className="fixed top-24 left-1/2 z-50 flex animate-aios-dialog w-[min(480px,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-3 rounded-panel border border-border bg-surface p-5 shadow-float">
          <Dialog.Title className="text-section font-semibold text-text">
            {copy.review.acceptTitle}
          </Dialog.Title>
          <Dialog.Description className="text-ui text-text-2">
            {copy.review.acceptBody(state.branch)}
          </Dialog.Description>
          <TextField
            label={copy.review.commitMessage}
            value={message}
            className="font-mono"
            hint={copy.review.commitMessageHint}
            error={touched && empty ? copy.review.commitMessageRequired : undefined}
            onChange={(e) => {
              setMessage(e.target.value);
              setTouched(true);
            }}
          />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-ui text-text">
                {target ? copy.review.merge(target) : copy.review.mergeDetached}
              </p>
              <p className="text-caption text-text-3">{copy.review.mergeHint}</p>
            </div>
            <Switch
              checked={merge && target !== null}
              onChange={setMerge}
              disabled={target === null}
              label={target ? copy.review.merge(target) : copy.review.mergeDetached}
            />
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button variant="secondary">{copy.review.cancel}</Button>
            </Dialog.Close>
            <Button
              variant="primary"
              disabled={busy || empty}
              onClick={() =>
                onAccept({ merge: merge && target !== null, commitMessage: message.trim() })
              }
            >
              {busy ? copy.review.accepting : copy.review.accept}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
