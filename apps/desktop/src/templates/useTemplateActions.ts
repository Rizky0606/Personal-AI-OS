import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { apiErrorMessage } from '../api/errors';
import { ApiProblem } from '../auth/authSession';
import { useOnline } from '../app/hooks';
import { api } from '../app/services';
import { copy } from '../copy';
import { useToastStore } from '../ui/Toaster';

/**
 * Simpan, ubah, dan hapus templat prompt. Kesalahan (mis. nama kembar) jadi toast dan aksi mengembalikan false,
 * supaya formulir tetap terbuka dan isian tidak hilang.
 */
export function useTemplateActions() {
  const queryClient = useQueryClient();
  const online = useOnline();
  const push = useToastStore((s) => s.push);
  const [busy, setBusy] = useState<string | null>(null);

  const guarded = useCallback(
    async (key: string, work: () => Promise<unknown>, done?: string): Promise<boolean> => {
      setBusy(key);
      try {
        await work();
        await queryClient.invalidateQueries({ queryKey: ['promptTemplates'] });
        if (done) push(done);
        return true;
      } catch (error) {
        const known =
          error instanceof ApiProblem
            ? (
                {
                  template_name_taken: copy.templates.nameTaken,
                  template_limit: copy.templates.limit,
                } as Record<string, string>
              )[error.code]
            : undefined;
        push(known ?? apiErrorMessage(error, online), 'danger');
        return false;
      } finally {
        setBusy(null);
      }
    },
    [online, push, queryClient],
  );

  const t = copy.templates;
  return {
    busy,
    create: (name: string, body: string) =>
      guarded(
        'create',
        () => api.createPromptTemplate({ name: name.trim(), body: body.trim() }),
        t.saved,
      ),
    edit: (id: string, patch: { name: string; body: string }) =>
      guarded(
        `edit:${id}`,
        () => api.updatePromptTemplate(id, { name: patch.name.trim(), body: patch.body.trim() }),
        t.updated,
      ),
    remove: (id: string) => guarded(`remove:${id}`, () => api.deletePromptTemplate(id), t.removed),
  };
}
