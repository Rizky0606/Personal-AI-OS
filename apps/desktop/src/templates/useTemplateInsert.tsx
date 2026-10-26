import type { PromptTemplate } from '@aios/contracts';
import { useState, type ReactNode } from 'react';
import { UseTemplateDialog } from './UseTemplateDialog';
import { templateParams } from './vars';

/**
 * Memasukkan templat ke kolom pesan: tanpa parameter langsung menggantikan draf, dengan parameter membuka dialog
 * isian dulu. `dialog` harus dirender oleh pemakai hook.
 */
export function useTemplateInsert(setDraft: (text: string) => void): {
  use: (template: PromptTemplate) => void;
  dialog: ReactNode;
} {
  const [pending, setPending] = useState<PromptTemplate | null>(null);
  return {
    use: (template) => {
      if (templateParams(template.body).length === 0) setDraft(template.body);
      else setPending(template);
    },
    dialog: (
      <UseTemplateDialog template={pending} onClose={() => setPending(null)} onSubmit={setDraft} />
    ),
  };
}
