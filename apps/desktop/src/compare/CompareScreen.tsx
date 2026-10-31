import { ChevronDown, Plus, X } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { apiErrorMessage } from '../api/errors';
import type { CompareResult } from '../api/gateway';
import { useModels } from '../api/queries';
import { useOnline } from '../app/hooks';
import { api } from '../app/services';
import { copy } from '../copy';
import { formatCount, formatDuration } from '../lib/format';
import { Markdown } from '../markdown/Markdown';
import { Button } from '../ui/Button';
import { ErrorBanner } from '../ui/ErrorBanner';
import { IconButton } from '../ui/IconButton';
import { RadioMenu } from '../ui/RadioMenu';
import { PageContainer } from '../ui/PageContainer';
import { PageHeader } from '../ui/PageHeader';
import { Skeleton, SkeletonList } from '../ui/Skeleton';
import { TextArea } from '../ui/TextArea';

const MIN_SLOTS = 2;
const MAX_SLOTS = 3;
const NONE = '__none__';

function ResultColumn({ result, label }: { result: CompareResult; label: string }) {
  const tokens = result.usage ? result.usage.inputTokens + result.usage.outputTokens : null;
  return (
    <section
      aria-label={label}
      className="flex min-w-0 flex-1 animate-aios-enter flex-col gap-3 rounded-panel border border-border bg-surface p-4"
    >
      <header className="flex flex-col gap-1">
        <h3 className="truncate font-mono text-ui font-medium text-text">{label}</h3>
        <p className="flex gap-3 text-meta text-text-2 tabular-nums">
          <span>
            {copy.compare.latency} {formatDuration(result.latencyMs)}
          </span>
          {tokens !== null ? (
            <span>
              {copy.compare.tokens} {formatCount(result.usage?.inputTokens ?? 0)} →{' '}
              {formatCount(result.usage?.outputTokens ?? 0)}
            </span>
          ) : null}
        </p>
      </header>
      {result.ok ? (
        result.text.trim() ? (
          <Markdown source={result.text} />
        ) : (
          <p className="text-ui text-text-3">{copy.compare.noText}</p>
        )
      ) : (
        <ErrorBanner message={result.error ?? copy.errors.unknown} />
      )}
    </section>
  );
}

/** Satu prompt ke 2-3 model berdampingan, dengan waktu dan pemakaian token per model. Tidak membuat percakapan. */
export function CompareScreen() {
  const modelsQuery = useModels();
  const online = useOnline();
  const models = modelsQuery.data ?? [];
  const [prompt, setPrompt] = useState('');
  const [promptError, setPromptError] = useState<string | undefined>();
  // null = ikuti bawaan (model ke-n dari daftar); string = pilihan pengguna.
  const [slots, setSlots] = useState<(string | null)[]>([null, null]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<CompareResult[] | null>(null);

  const chosen = slots.map((slot, i) => slot ?? models[i]?.id ?? NONE);
  const labelOf = (id: string) => models.find((m) => m.id === id)?.label ?? id;
  const distinct = new Set(chosen.filter((id) => id !== NONE));
  const valid = distinct.size === chosen.length && chosen.length >= MIN_SLOTS;
  const c = copy.compare;

  async function run() {
    if (running) return;
    if (!prompt.trim()) {
      setPromptError(c.emptyPrompt);
      return;
    }
    if (!valid) {
      setError(c.needTwo);
      return;
    }
    setPromptError(undefined);
    setError(null);
    setResults(null);
    setRunning(true);
    try {
      setResults(await api.compareModels(prompt.trim(), chosen));
    } catch (e) {
      setError(apiErrorMessage(e, online));
    } finally {
      setRunning(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void run();
    }
  }

  return (
    <div className="flex flex-col" onKeyDown={onKeyDown}>
      <PageHeader title={c.title} />
      <PageContainer>
        <div className="flex flex-col gap-5">
          <p className="max-w-[72ch] text-ui text-text-2">{c.intro}</p>
          <TextArea
            label={c.prompt}
            hint={c.promptHint}
            rows={4}
            value={prompt}
            error={promptError}
            onChange={(e) => setPrompt(e.target.value)}
          />

          {modelsQuery.isPending ? (
            <SkeletonList rows={1} label={c.modelsLoading} />
          ) : models.length === 0 ? (
            <p className="text-ui text-text-2">{c.noModels}</p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {chosen.map((id, index) => (
                <span key={index} className="flex items-center gap-1">
                  <RadioMenu
                    label={c.pick}
                    value={id}
                    onValueChange={(value) =>
                      setSlots((s) => s.map((x, i) => (i === index ? value : x)))
                    }
                    options={models.map((m) => ({ value: m.id, label: m.label, hint: m.kind }))}
                    trigger={
                      <button
                        type="button"
                        aria-label={`${c.modelSlot(index + 1)}: ${id === NONE ? c.none : labelOf(id)}`}
                        className="flex h-9 max-w-56 items-center gap-2 rounded-control border border-border bg-surface px-3 text-ui text-text transition-colors duration-[120ms] ease-aios hover:border-border-strong hover:bg-surface-2"
                      >
                        <span className="truncate">{id === NONE ? c.none : labelOf(id)}</span>
                        <ChevronDown
                          size={14}
                          strokeWidth={1.5}
                          aria-hidden="true"
                          className="shrink-0 text-text-2"
                        />
                      </button>
                    }
                  />
                  {chosen.length > MIN_SLOTS ? (
                    <IconButton
                      label={c.remove(index + 1)}
                      onClick={() => setSlots((s) => s.filter((_, i) => i !== index))}
                    >
                      <X size={14} strokeWidth={1.5} aria-hidden="true" />
                    </IconButton>
                  ) : null}
                </span>
              ))}
              {chosen.length < MAX_SLOTS ? (
                <Button variant="ghost" onClick={() => setSlots((s) => [...s, null])}>
                  <Plus size={14} strokeWidth={1.5} aria-hidden="true" />
                  {c.add}
                </Button>
              ) : null}
              <Button
                variant="primary"
                disabled={running}
                onClick={() => void run()}
                className="ml-auto"
              >
                {running ? c.running : c.run}
              </Button>
            </div>
          )}

          {error ? <ErrorBanner message={error} /> : null}
          {running ? (
            <div role="status" aria-label={c.running} className="flex gap-3">
              {chosen.map((id, i) => (
                <div
                  key={i}
                  className="flex flex-1 flex-col gap-2 rounded-panel border border-border p-4"
                >
                  <span className="sr-only">{labelOf(id)}</span>
                  <Skeleton className="w-full" />
                  <Skeleton className="w-full" />
                  <Skeleton className="w-1/3" />
                </div>
              ))}
            </div>
          ) : null}
          {results ? (
            <div role="group" aria-label={c.results} className="flex flex-col gap-3 lg:flex-row">
              {results.map((r) => (
                <ResultColumn key={r.model} result={r} label={labelOf(r.model)} />
              ))}
            </div>
          ) : null}
        </div>
      </PageContainer>
    </div>
  );
}
