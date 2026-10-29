import { Check, CircleSlash, Loader, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { copy } from '../copy';
import { cn } from '../lib/cn';
import type { SubagentView } from '../realtime/liveRun';
import { formatDuration } from '../chat/ToolStepRow';

const ICON = { size: 14, strokeWidth: 1.5, 'aria-hidden': true } as const;

const statusIcon: Record<SubagentView['status'], ReactNode> = {
  running: <Loader {...ICON} className="animate-aios-breathe text-accent" />,
  completed: <Check {...ICON} className="text-success" />,
  failed: <TriangleAlert {...ICON} className="text-danger" />,
  aborted: <CircleSlash {...ICON} className="text-warning" />,
};

/** Subagent omp (tool `task`) yang dijalankan agent induk: satu simpul per subagent di bawah akar agent. */
export function SubagentTree({ subagents }: { subagents: readonly SubagentView[] }) {
  const t = copy.activity.subagents;
  return (
    <section aria-label={t.title} className="flex flex-col gap-2">
      <h3 className="text-meta font-medium text-text-2">{t.title}</h3>
      <ul className="ml-2 flex flex-col gap-3 border-l border-border-strong pl-4">
        {subagents.map((agent) => (
          <li
            key={agent.subagentId}
            className="relative flex animate-aios-enter flex-col gap-1 before:absolute before:top-2 before:-left-4 before:h-px before:w-3 before:bg-border-strong"
          >
            <span className="flex min-w-0 items-center gap-2 text-ui">
              {statusIcon[agent.status]}
              <span className="sr-only">{t.status[agent.status]}: </span>
              <span className="truncate font-medium text-text">{agent.subagentId}</span>
              {agent.agent ? (
                <span className="rounded-full bg-surface-2 px-2 py-0.5 font-mono text-caption text-text-2">
                  {agent.agent}
                </span>
              ) : null}
            </span>
            {agent.assignment ? (
              <span className="line-clamp-2 text-meta text-text-2">{agent.assignment}</span>
            ) : null}
            <span
              className={cn(
                'flex gap-3 font-mono text-caption text-text-3',
                agent.status === 'running' && 'text-text-2',
              )}
            >
              <span>{t.tools(agent.toolCount)}</span>
              {agent.durationMs > 0 ? <span>{formatDuration(agent.durationMs)}</span> : null}
            </span>
            {agent.lastOutput ? (
              <span className="truncate font-mono text-caption text-text-3">
                {agent.lastOutput}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
