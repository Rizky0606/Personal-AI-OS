import type { PromptTemplate } from '@aios/contracts';
import { useEffect, useMemo, useState } from 'react';
import { copy } from '../copy';
import { DialogFrame } from '../screens/DialogFrame';
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
    <DialogFrame
      open={template !== null}
      onOpenChange={(open) => !open && onClose()}
      title={template ? `/${template.name}` : ''}
      description={t.fillBody}
      size="sm"
      onSubmit={submit}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            {copy.chat.cancel}
          </Button>
          <Button type="submit" variant="primary">
            {t.insert}
          </Button>
        </>
      }
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
    </DialogFrame>
  );
}
