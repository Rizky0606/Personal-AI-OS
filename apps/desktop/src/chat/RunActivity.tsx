import { ChevronDown, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { copy } from '../copy';
import type { Activity } from '../realtime/activity';
import { AgentOrb, orbStateOf } from './AgentOrb';
import { ToolStepRow } from './ToolStepRow';

export interface RunActivityProps {
  activity: Activity;
  now: number;
  onApproval?: () => void;
  output?: string | undefined;
}

const ui = copy.runActivity.ui;

export function RunActivity({ activity, onApproval, output }: RunActivityProps) {
  const [open, setOpen] = useState(activity.needsAttention);
  const toggle = () => setOpen((value) => !value);
  return (
    <section className={`aios-run-activity aios-run-activity-${activity.phase}`} aria-live="polite">
      <button
        type="button"
        aria-label={ui.toggle}
        aria-expanded={open}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggle();
          }
        }}
        className="flex min-h-11 w-full items-center gap-2 rounded-control border border-border bg-surface-2 px-3 text-left"
      >
        <AgentOrb state={orbStateOf(activity.phase)} size={16} />
        <span className="min-w-0 flex-1 text-ui text-text">
          {activity.current?.label ?? activity.headline ?? ui.phase[activity.phase]}
          {activity.current?.target ? (
            <span className="ml-2 text-text-3">{activity.current.target}</span>
          ) : null}
        </span>
        <span className="shrink-0 text-meta text-text-3">
          {Math.round(activity.elapsedMs / 1000)} {copy.runActivity.units.second}
        </span>
        <ChevronDown size={14} aria-hidden="true" className={open ? 'rotate-180' : ''} />
      </button>
      {activity.summary ? <p className="sr-only">{activity.summary}</p> : null}
      {open ? (
        <div className="flex flex-col gap-2 border-x border-b border-border px-3 py-2">
          {output ? (
            <p className="truncate font-mono text-meta text-text-2" aria-label={ui.toolOutput}>
              {output}
            </p>
          ) : null}
          {activity.steps.map((step) => (
            <ToolStepRow
              key={step.id}
              name={step.label}
              target={step.target}
              status={step.status}
              durationMs={step.durationMs ?? undefined}
            />
          ))}
          {activity.hiddenCount > 0 ? (
            <p className="text-meta text-text-3">{ui.moreSteps(activity.hiddenCount)}</p>
          ) : null}
          {activity.summary &&
          activity.phase !== 'done' &&
          activity.phase !== 'error' &&
          activity.phase !== 'cancelled' ? (
            <p className="text-ui font-medium text-text">{activity.summary}</p>
          ) : null}
          {activity.phase === 'waiting_approval' ? (
            <button
              type="button"
              onClick={onApproval}
              className="inline-flex min-h-11 items-center gap-2 self-start text-ui text-warning underline"
            >
              {ui.openApproval} <ExternalLink size={14} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
