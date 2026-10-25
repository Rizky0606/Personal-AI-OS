import { MEMORY_TEXT_MAX } from '@aios/contracts';
import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';
import { useOnline } from '../app/hooks';
import { copy } from '../copy';
import { Button } from '../ui/Button';
import { TextArea } from '../ui/TextArea';
import { useMemoryActions } from './useMemoryActions';

export interface RememberDialogProps {
  /** Teks awal (isi pesan); null = dialog tertutup. Pemilik meringkasnya dulu sebelum disimpan. */
  text: string | null;
  onClose: () => void;
}

/** "Ingat ini": menyimpan teks pesan (yang bisa disunting) sebagai memori baru. */
export function RememberDialog({ text, onClose }: RememberDialogProps) {
  const [value, setValue] = useState('');
  const online = useOnline();
  const actions = useMemoryActions();
  const m = copy.memory;
  const saving = actions.busy === 'create';

  useEffect(() => {
    if (text !== null) setValue(text.trim().slice(0, MEMORY_TEXT_MAX));
  }, [text]);

  async function save() {
    if (!value.trim() || saving) return;
    if (await actions.create(value)) onClose();
  }

  return (
    <Dialog.Root open={text !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 animate-aios-fade bg-bg/60" />
        <Dialog.Content className="fixed top-24 left-1/2 z-50 flex animate-aios-dialog w-[min(520px,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-3 rounded-panel border border-border bg-surface p-4 shadow-float">
          <Dialog.Title className="text-section font-semibold text-text">
            {m.rememberTitle}
          </Dialog.Title>
          <Dialog.Description className="text-ui text-text-2">{m.rememberBody}</Dialog.Description>
          <TextArea
            label={m.addLabel}
            hint={m.counter(value.trim().length, MEMORY_TEXT_MAX)}
            value={value}
            rows={4}
            maxLength={MEMORY_TEXT_MAX}
            autoFocus
            disabled={saving}
            onChange={(event) => setValue(event.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={saving} onClick={onClose}>
              {copy.chat.cancel}
            </Button>
            <Button
              variant="primary"
              disabled={!online || saving || !value.trim()}
              onClick={() => void save()}
            >
              {saving ? m.saving : m.add}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
