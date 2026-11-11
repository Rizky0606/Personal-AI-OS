import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiErrorMessage } from '../api/errors';
import { useOnline } from '../app/hooks';
import { api } from '../app/services';
import { copy } from '../copy';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { StateView, type ViewState } from '../ui/StateView';
import { needsAcknowledge } from './skillErrors';
import { useSkillActions } from './useSkillActions';

const t = copy.skillsPage.hermes;

/** Skill milik Hermes, hanya baca; impor menyalin isinya ke katalog lewat pemindai yang sama. */
export function HermesTab() {
  const online = useOnline();
  const { busy, run } = useSkillActions();
  const [pending, setPending] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['skillHermes'], queryFn: () => api.listHermesSkills() });
  const items = list.data?.items ?? [];

  const state: ViewState = list.isPending
    ? online
      ? 'loading'
      : 'offline'
    : list.isError
      ? online
        ? 'error'
        : 'offline'
      : items.length === 0
        ? 'empty'
        : 'content';

  async function importSkill(name: string, acknowledge: boolean) {
    const done = await run(
      `import:${name}`,
      () => api.importHermesSkill(name, acknowledge),
      t.importedToast,
      (err) => {
        // Peringatan pemindai: minta persetujuan eksplisit, bukan toast galat.
        if (!needsAcknowledge(err) || acknowledge) return false;
        setPending(name);
        return true;
      },
    );
    if (done) setPending(null);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-[72ch] text-ui text-text-2">{t.intro}</p>
      {list.data ? (
        <p className="text-meta text-text-2">
          {t.via[list.data.via]}
          {list.data.note ? ` · ${list.data.note}` : ''}
        </p>
      ) : null}
      <StateView
        state={state}
        loadingLabel={copy.skillsPage.loading}
        emptyMessage={t.empty}
        errorMessage={apiErrorMessage(list.error, online)}
        offlineMessage={copy.states.offline}
        retryLabel={copy.states.retry}
        onRetry={() => void list.refetch()}
        emptyAction={
          <Button disabled={!online} onClick={() => void list.refetch()}>
            {t.refresh}
          </Button>
        }
      >
        <ul className="flex flex-col rounded-panel border border-border bg-surface">
          {items.map((skill) => (
            <li
              key={skill.name}
              className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0"
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-ui font-medium text-text">{skill.name}</span>
                <span className="truncate text-meta text-text-2">{skill.description}</span>
              </span>
              {skill.imported ? (
                <span className="text-meta text-text-2">{t.imported}</span>
              ) : skill.importable ? (
                <Button
                  aria-label={`${t.import} ${skill.name}`}
                  disabled={!online || busy !== null}
                  onClick={() => void importSkill(skill.name, false)}
                >
                  {busy === `import:${skill.name}` ? t.importing : t.import}
                </Button>
              ) : (
                <span className="text-meta text-text-3">{t.notImportable}</span>
              )}
            </li>
          ))}
        </ul>
      </StateView>
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        title={t.acknowledgeTitle}
        body={t.acknowledgeBody}
        confirmLabel={t.acknowledgeConfirm}
        cancelLabel={copy.skillsPage.editor.cancel}
        busy={busy !== null}
        onConfirm={() => pending && void importSkill(pending, true)}
      />
    </div>
  );
}
