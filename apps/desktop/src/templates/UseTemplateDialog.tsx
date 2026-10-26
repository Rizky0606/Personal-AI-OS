import type { PromptTemplate } from '@aios/contracts';
import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useMemo, useState } from 'react';
import { copy } from '../copy';
import { Button } from '../ui/Button';
import { TextField } from '../ui/TextField';
import { fillTemplate, templateParams } from './vars';

export interface UseTemplateDialogProps {
  /** Templat dengan parameter; null = dialog tertutup. */
  template: PromptTemplate | null;
  onClose: () => void;
  /** Teks akhir setelah semua parameter diisi. */
  onSubmit: (text: string) => void;
}

/** Meminta nilai tiap `{{parameter}}` sebelum templat dimasukkan ke kolom pesan. */
export function UseTemplateDialog({ template, onClose, onSubmit }: UseTemplateDialogProps) {
  const params = useMemo(() => (template ? templateParams(template.body) : []), [template]);
  const [values, setValues] = useState<Record<string, string>>({});
  const t = copy.templates;

  useEffect(() => setValues({}), [template]);

  function submit() {
    if (!template) return;
    onSubmit(fillTemplate(template.body, values));
    onClose();
  }

  return (
    <Dialog.Root open={template !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 animate-aios-fade bg-bg/60" />
        <Dialog.Content className="fixed top-24 left-1/2 z-50 flex animate-aios-dialog w-[min(480px,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-3 rounded-panel border border-border bg-surface p-4 shadow-float">
          <Dialog.Title className="text-section font-semibold text-text">
            {template ? `/${template.name}` : ''}
          </Dialog.Title>
          <Dialog.Description className="text-ui text-text-2">{t.fillBody}</Dialog.Description>
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            {params.map((name, i) => (
              <TextField
                key={name}
                label={name}
                value={values[name] ?? ''}
                autoFocus={i === 0}
                onChange={(event) => setValues((v) => ({ ...v, [name]: event.target.value }))}
              />
            ))}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                {copy.chat.cancel}
              </Button>
              <Button type="submit" variant="primary">
                {t.insert}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
