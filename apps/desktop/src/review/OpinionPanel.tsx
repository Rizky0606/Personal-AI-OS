import {
  OPINION_MAX_FILES,
  OPINION_MAX_PATCH_CHARS,
  type OpinionFinding,
  type ReviewFile,
} from '@aios/contracts';
import { useState } from 'react';
import { apiErrorMessage } from '../api/errors';
import type { OpinionResult } from '../api/gateway';
import { useModels } from '../api/queries';
import { useOnline } from '../app/hooks';
import { api } from '../app/services';
import { copy } from '../copy';
import { cn } from '../lib/cn';
import { useUiStore } from '../state/uiStore';
import { Button } from '../ui/Button';
import { ErrorBanner } from '../ui/ErrorBanner';

export interface OpinionPanelProps {
  files: ReviewFile[];
  /** Ada tidaknya komentar pada baris itu; temuan yang sudah jadi komentar tidak ditawarkan lagi. */
  hasComment: (path: string, line: number) => boolean;
  onAddComment: (path: string, line: number, body: string) => void;
  disabled?: boolean;
}

const SEVERITY_CLASS = {
  bug: 'bg-danger',
  warning: 'bg-warning',
  info: 'bg-info',
} as const;

const prefixOf = (f: OpinionFinding) => copy.review.opinion.severity[f.severity];

/**
 * Pendapat kedua: model lain meninjau diff (bug, risiko, tes yang kurang) sebelum diterima. Temuan per baris bisa
 * dijadikan komentar, lalu dikirim ke agent bersama komentar lain.
 */
export function OpinionPanel({
  files,
  hasComment,
  onAddComment,
  disabled = false,
}: OpinionPanelProps) {
  const online = useOnline();
  const models = useModels();
  const chosen = useUiStore((s) => s.model);
  const [result, setResult] = useState<OpinionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const o = copy.review.opinion;
  const model = chosen ?? models.data?.[0]?.id ?? null;
  const reviewable = files.filter((f) => !f.binary && f.patch !== '').slice(0, OPINION_MAX_FILES);

  async function ask() {
    if (!model) {
      setError(o.noModel);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setResult(
        await api.reviewOpinion({
          model,
          files: reviewable.map((f) => ({
            path: f.path,
            patch: f.patch.slice(0, OPINION_MAX_PATCH_CHARS),
          })),
        }),
      );
    } catch (err) {
      setError(apiErrorMessage(err, online));
    } finally {
      setBusy(false);
    }
  }

  const addable = (result?.findings ?? []).filter(
    (f): f is OpinionFinding & { line: number } => f.line !== null && !hasComment(f.path, f.line),
  );

  return (
    <section
      aria-label={o.title}
      className="flex flex-col gap-3 rounded-panel border border-border bg-surface-2 p-4"
    >
      <div className="flex items-center gap-2">
        <h3 className="text-ui font-semibold text-text">{o.title}</h3>
        <Button
          variant="secondary"
          className="ml-auto"
          disabled={disabled || busy || !online || reviewable.length === 0}
          onClick={() => void ask()}
        >
          {busy ? o.asking : result ? o.askAgain : o.ask}
        </Button>
      </div>
      {error ? <ErrorBanner message={error} /> : null}
      {result ? (
        <div className="flex flex-col gap-2">
          <p className="text-meta text-text-3">{o.reviewedBy(result.model)}</p>
          {result.summary ? <p className="text-ui text-text">{result.summary}</p> : null}
          {result.truncated ? <p className="text-meta text-text-2">{o.truncated}</p> : null}
          {result.findings.length === 0 ? (
            <p className="text-ui text-text-2">{o.clean}</p>
          ) : (
            <>
              <ul aria-label={o.findings} className="flex flex-col gap-2">
                {result.findings.map((f, i) => {
                  const added = f.line !== null && hasComment(f.path, f.line);
                  return (
                    <li
                      key={`${f.path}:${f.line}:${i}`}
                      className="flex animate-aios-enter flex-col gap-1 border-t border-border pt-3"
                    >
                      <div className="flex items-center gap-2 text-meta text-text-2">
                        <span
                          aria-hidden="true"
                          className={cn('size-2 shrink-0 rounded-full', SEVERITY_CLASS[f.severity])}
                        />
                        <span className="font-medium text-text">{prefixOf(f)}</span>
                        <span className="min-w-0 truncate font-mono">
                          {f.path}
                          {f.line !== null ? `:${f.line}` : ''}
                        </span>
                      </div>
                      <p className="text-ui text-text">{f.body}</p>
                      {f.line !== null ? (
                        <div>
                          <Button
                            variant="ghost"
                            disabled={disabled || added}
                            aria-label={`${added ? o.added : o.addComment}: ${f.path}:${f.line}`}
                            onClick={() =>
                              onAddComment(f.path, f.line!, `${prefixOf(f)}: ${f.body}`)
                            }
                          >
                            {added ? o.added : o.addComment}
                          </Button>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              {addable.length > 1 ? (
                <div>
                  <Button
                    variant="secondary"
                    disabled={disabled}
                    onClick={() =>
                      addable.forEach((f) =>
                        onAddComment(f.path, f.line, `${prefixOf(f)}: ${f.body}`),
                      )
                    }
                  >
                    {o.addAll(addable.length)}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
