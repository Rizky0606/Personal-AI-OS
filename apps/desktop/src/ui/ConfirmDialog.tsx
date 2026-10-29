import * as Dialog from '@radix-ui/react-dialog';
import { Button } from './Button';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  /** Aksi merusak (membuang pekerjaan): tombol konfirmasi bergaya bahaya. */
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
}

/** Konfirmasi singkat sebelum aksi yang tidak bisa dibatalkan; fokus awal di tombol Batal. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  cancelLabel,
  destructive = false,
  busy = false,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 animate-aios-fade bg-bg/60" />
        <Dialog.Content className="fixed top-24 left-1/2 z-50 flex animate-aios-dialog w-[min(440px,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-3 rounded-panel border border-border bg-surface p-5 shadow-float">
          <Dialog.Title className="text-section font-semibold text-text">{title}</Dialog.Title>
          <Dialog.Description className="text-ui text-text-2">{body}</Dialog.Description>
          <div className="mt-2 flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button variant="secondary" autoFocus>
                {cancelLabel}
              </Button>
            </Dialog.Close>
            <Button
              variant={destructive ? 'danger' : 'primary'}
              disabled={busy}
              onClick={onConfirm}
            >
              {confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
