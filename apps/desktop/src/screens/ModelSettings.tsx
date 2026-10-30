import { apiErrorMessage } from '../api/errors';
import { useModels } from '../api/queries';
import { useOnline } from '../app/hooks';
import { copy } from '../copy';
import { cn } from '../lib/cn';
import { useUiStore } from '../state/uiStore';
import { Button } from '../ui/Button';
import { enterProps } from '../ui/enter';
import { StateView, type ViewState } from '../ui/StateView';

interface Option {
  value: string | null;
  label: string;
  hint: string;
}

/** Pemilih model untuk pesan berikutnya: Otomatis (router/combo) atau satu model, dengan keterangan singkat. */
export function ModelSettings() {
  const query = useModels();
  const online = useOnline();
  const model = useUiStore((s) => s.model);
  const setModel = useUiStore((s) => s.setModel);
  const models = query.data ?? [];

  const view: ViewState = query.isPending
    ? 'loading'
    : query.isError && !query.data
      ? online
        ? 'error'
        : 'offline'
      : models.length === 0
        ? 'empty'
        : 'content';

  const options: Option[] = [
    { value: null, label: copy.settings.modelAuto, hint: copy.settings.modelAutoHint },
    ...models.map((m) => ({
      value: m.id,
      label: m.label,
      hint: m.kind === 'combo' ? copy.settings.modelHint.combo : copy.settings.modelHint.model(m.ownedBy),
    })),
  ];

  return (
    <StateView
      state={view}
      loadingLabel={copy.settings.modelLoading}
      emptyMessage={copy.settings.modelEmpty}
      errorMessage={query.isError ? apiErrorMessage(query.error, online) : ''}
      offlineMessage={copy.states.offline}
      retryLabel={copy.states.retry}
      onRetry={() => void query.refetch()}
      emptyAction={
        <Button variant="secondary" onClick={() => void query.refetch()}>
          {copy.states.retry}
        </Button>
      }
    >
      <div role="radiogroup" aria-label={copy.settings.modelLabel} className="flex flex-col gap-2">
        {options.map((option, i) => {
          const checked = option.value === model;
          const enter = enterProps(i);
          return (
            <button
              key={option.value ?? 'auto'}
              type="button"
              role="radio"
              aria-checked={checked}
              onClick={() => setModel(option.value)}
              style={enter.style}
              className={cn(
                'flex min-h-11 flex-col items-start rounded-control border px-3 py-2 text-left transition-colors duration-[180ms] ease-aios',
                checked ? 'border-accent bg-accent-soft' : 'border-border bg-surface hover:bg-surface-2',
                enter.className,
              )}
            >
              <span className="text-ui font-medium text-text">{option.label}</span>
              <span className="text-meta text-text-2">{option.hint}</span>
            </button>
          );
        })}
      </div>
    </StateView>
  );
}
