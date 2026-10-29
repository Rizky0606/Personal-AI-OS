import { Check } from 'lucide-react';
import { copy } from '../copy';
import { cn } from '../lib/cn';
import { enterDelay } from '../screens/PageLayout';

export const RESEARCH_STAGES = ['planning', 'searching', 'reading', 'writing'] as const;
export type StageId = (typeof RESEARCH_STAGES)[number];

export interface ResearchProgressProps {
  stage: string | null;
  /** 0 sampai 1 untuk tahap saat ini. */
  progress: number;
  message?: string | undefined;
}

/** Empat tahap berurutan dan bilah kemajuan keseluruhan; tahap saat ini diberi aksen. */
export function ResearchProgress({ stage, progress, message }: ResearchProgressProps) {
  const current = RESEARCH_STAGES.indexOf(stage as StageId);
  const overall =
    current < 0
      ? 0
      : Math.min(1, (current + Math.min(1, Math.max(0, progress))) / RESEARCH_STAGES.length);
  const percent = Math.round(overall * 100);
  return (
    <section aria-label={copy.research.progress} className="flex flex-col gap-3">
      <div
        role="progressbar"
        aria-label={copy.research.progress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-1 overflow-hidden rounded-badge bg-surface-2"
      >
        <div
          className="h-full bg-accent transition-[width] duration-[240ms] ease-aios"
          style={{ width: `${percent}%` }}
        />
      </div>
      <ol className="flex flex-col divide-y divide-border overflow-hidden rounded-panel border border-border bg-surface text-ui">
        {RESEARCH_STAGES.map((id, index) => {
          const done = current > index;
          const active = current === index;
          return (
            <li
              key={id}
              aria-current={active ? 'step' : undefined}
              style={enterDelay(index)}
              className={cn(
                'flex min-h-9 animate-aios-enter items-center gap-2 px-4 py-2 transition-colors duration-[120ms] ease-aios hover:bg-surface-2',
                active ? 'font-medium text-text' : done ? 'text-text-2' : 'text-text-3',
              )}
            >
              {done ? (
                <Check size={14} strokeWidth={1.5} aria-hidden="true" className="text-success" />
              ) : (
                <span
                  aria-hidden="true"
                  className={cn('size-1.5 rounded-full', active ? 'bg-accent' : 'bg-border-strong')}
                />
              )}
              {copy.research.stages[id]}
            </li>
          );
        })}
      </ol>
      {message ? <p className="text-meta text-text-2">{message}</p> : null}
    </section>
  );
}
