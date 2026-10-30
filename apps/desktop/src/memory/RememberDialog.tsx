import { MEMORY_TEXT_MAX } from '@aios/contracts';
import { useEffect, useState } from 'react';
import { useOnline } from '../app/hooks';
import { copy } from '../copy';
import { DialogFrame } from '../screens/DialogFrame';
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
    <DialogFrame
      open={text !== null}
      onOpenChange={(open) => !open && onClose()}
      title={m.rememberTitle}
      description={m.rememberBody}
      footer={
        <>
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
        </>
      }
    >
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
    </DialogFrame>
  );
}
