import { TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { copy } from '../copy';
import { cn } from '../lib/cn';
import type { ActivityPhase } from '../realtime/activity';
import type { ProgressStep, StepState } from '../realtime/progress';

/** Dua langkah selesai terakhir tetap terlihat (redup); yang lebih lama diringkas jadi satu tombol. */
export const VISIBLE_DONE = 2;

/** Warna titik langkah aktif mengikuti fase run (token status). */
const ACTIVE_DOT: Partial<Record<ActivityPhase, string>> = {
  thinking: 'bg-thinking',
  tool: 'bg-tool',
  writing: 'bg-writing',
  waiting_approval: 'bg-warning',
  error: 'bg-error',
};

/** Indeks langkah pertama yang belum selesai (batas antara riwayat dan yang sedang/akan dikerjakan). */
export function frontierOf(steps: readonly ProgressStep[]): number {
  const i = steps.findIndex((s) => s.state !== 'done');
  return i < 0 ? steps.length : i;
}

/** Jumlah langkah selesai lama yang diringkas ("N langkah sebelumnya"); 0 bila tidak lebih dari dua yang selesai. */
export function collapsedCount(steps: readonly ProgressStep[]): number {
  return Math.max(0, frontierOf(steps) - VISIBLE_DONE);
}

function Dot({ state, phase }: { state: StepState; phase: ActivityPhase | null }) {
  if (state === 'blocked')
    return (
      <TriangleAlert
        size={14}
        strokeWidth={1.5}
        aria-hidden="true"
        className="relative mt-1.5 shrink-0 bg-surface-1 text-warning"
      />
    );
  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative mt-2 size-2 shrink-0 rounded-full transition-[background-color,transform] duration-[320ms] ease-spring',
        state === 'active' &&
          cn(
            'scale-125 animate-aios-breathe',
            (phase ? ACTIVE_DOT[phase] : undefined) ?? 'bg-accent',
          ),
        state === 'done' && 'bg-text-3',
        state === 'abandoned' && 'bg-text-3',
        state === 'pending' && 'border border-border-strong bg-surface-1',
      )}
    />
  );
}

function Step({
  step,
  phase,
  dim,
  last,
}: {
  step: ProgressStep;
  phase: ActivityPhase | null;
  dim: boolean;
  last: boolean;
}) {
  return (
    <li
      data-state={step.state}
      aria-current={step.state === 'active' ? 'step' : undefined}
      className="flex gap-3"
    >
      <div className="relative flex w-4 shrink-0 justify-center">
        {last ? null : <span aria-hidden="true" className="absolute inset-y-0 w-px bg-border" />}
        <Dot state={step.state} phase={phase} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 pb-3">
        {step.phase ? (
          <span className="text-caption font-semibold tracking-wide text-text-3 uppercase">
            {step.phase}
          </span>
        ) : null}
        <span
          className={cn(
            'text-ui break-words transition-colors duration-[240ms] ease-aios',
            step.state === 'active' ? 'font-medium text-text' : 'text-text-2',
            (dim || step.state === 'done') && step.state !== 'active' && 'text-text-3',
            step.state === 'abandoned' && 'line-through',
          )}
        >
          <span className="sr-only">{copy.progress.state[step.state]}: </span>
          {step.label}
        </span>
        {step.state === 'blocked' && step.blocker ? (
          <span className="text-meta text-text-2">{step.blocker}</span>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Linimasa vertikal rencana agent: langkah selesai lama diringkas ("N langkah sebelumnya", tombol yang bisa
 * dibuka), dua langkah selesai terakhir redup, langkah aktif dengan titik berdenyut berwarna fase, berikutnya
 * teks biasa. Status selalu ada di teks (sr-only), bukan hanya warna.
 */
export function ProgressTimeline({
  steps,
  phase,
}: {
  steps: ProgressStep[];
  phase: ActivityPhase | null;
}) {
  const [open, setOpen] = useState(false);
  const older = collapsedCount(steps);
  const shown = open ? steps : steps.slice(older);
  const frontier = frontierOf(steps);
  return (
    <ol aria-label={copy.progress.timeline} className="flex flex-col">
      {older > 0 && !open ? (
        <li className="flex gap-3">
          <div className="relative flex w-4 shrink-0 justify-center">
            <span aria-hidden="true" className="absolute inset-y-0 w-px bg-border" />
          </div>
          <div className="pb-3">
            <button
              type="button"
              aria-expanded={false}
              onClick={() => setOpen(true)}
              className="rounded-control text-ui text-text-2 underline decoration-border-strong underline-offset-2 transition-colors duration-[120ms] ease-aios hover:text-text"
            >
              {copy.progress.previous(older)}
            </button>
          </div>
        </li>
      ) : null}
      {older > 0 && open ? (
        <li className="flex gap-3">
          <div className="relative flex w-4 shrink-0 justify-center">
            <span aria-hidden="true" className="absolute inset-y-0 w-px bg-border" />
          </div>
          <div className="pb-3">
            <button
              type="button"
              aria-expanded
              onClick={() => setOpen(false)}
              className="rounded-control text-ui text-text-2 underline decoration-border-strong underline-offset-2 transition-colors duration-[120ms] ease-aios hover:text-text"
            >
              {copy.progress.previous(older)}
            </button>
          </div>
        </li>
      ) : null}
      {shown.map((step) => {
        const index = steps.indexOf(step);
        return (
          <Step
            key={step.id}
            step={step}
            phase={phase}
            dim={index < frontier}
            last={index === steps.length - 1}
          />
        );
      })}
    </ol>
  );
}
